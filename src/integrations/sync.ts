import { lockWorkspaceOwner } from '@/lib/workspace-owner';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { decrypt, AppError, safeProviderError } from '@/lib/security';
import { normalizeDomain } from '@/lib/domain';
import { adapter, type Credentials } from './adapters';
import { isAvailableProvider, type ProviderId } from './catalog';
import type { Context } from '@/lib/access';
import { requireRole } from '@/lib/permissions';
import { audit } from '@/lib/portfolio';
import { lockWritableWorkspace, lockWorkspaceMembershipForActor } from '@/lib/workspace-write';
import { reportError } from '@/lib/telemetry';
import { queueActivityNotice } from '@/lib/activity-notices';
export async function queueSync(ctx: Context, accountId: string) {
  requireRole(ctx);
  const account = await db.providerAccount.findFirst({
    where: { id: accountId, organizationId: ctx.org.id, credential: { isNot: null } },
  });
  if (!account) throw new AppError('Connected account not found', 404);
  if (!isAvailableProvider(account.providerId)) throw new AppError('Provider unavailable', 409);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
    await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${account.id} FOR UPDATE`;
    const current = await tx.providerAccount.findFirst({
      where: { id: accountId, organizationId: ctx.org.id, credential: { isNot: null } },
    });
    if (!current) throw new AppError('Connected account not found', 404);
    const pending = await tx.syncJob.findFirst({
      where: { providerAccountId: accountId, status: { in: ['queued', 'running'] } },
    });
    if (pending) {
      return pending;
    }
    const job = await tx.syncJob.create({
      data: { providerAccountId: accountId, requestedBy: ctx.user.id! },
    });
    await audit(tx, ctx, 'sync.queued', job.id);
    return job;
  });
}
export async function runSync(jobId: string) {
  const job = await db.syncJob.findUnique({
    where: { id: jobId },
    include: {
      account: {
        include: {
          credential: true,
          organization: true,
        },
      },
    },
  });
  if (!job || !['queued', 'running'].includes(job.status)) return;
  try {
    if (!isAvailableProvider(job.account.providerId)) {
      await db.syncJob.updateMany({
        where: { id: job.id, status: { in: ['queued', 'running'] } },
        data: { status: 'failed', error: 'Provider unavailable', finishedAt: new Date() },
      });
      return;
    }
    await db.$transaction(async (tx) => {
      await lockWorkspaceOwner(tx, job.account.organizationId);
      if (job.requestedBy)
        await lockWorkspaceMembershipForActor(
          tx,
          job.account.organizationId,
          job.requestedBy,
          'EDITOR',
          false,
          'sync',
        );
    });
  } catch (error) {
    if (error instanceof AppError && [403, 409, 429].includes(error.status)) {
      await db.syncJob.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'failed', error: safeProviderError(error), finishedAt: new Date() },
      });
      throw error;
    }
    throw error;
  }
  const now = new Date();
  const claim = await db.providerAccount.updateMany({
    where: { id: job.providerAccountId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(Date.now() + 600000), lockOwner: job.id },
  });
  if (!claim.count) throw new AppError('Account is already synchronizing', 409);
  const heartbeat = setInterval(() => {
    void db.providerAccount
      .updateMany({
        where: { id: job.providerAccountId, lockOwner: job.id },
        data: { lockedUntil: new Date(Date.now() + 600000) },
      })
      .catch(() => undefined);
  }, 30000);
  let added = 0;
  let updated = 0;
  try {
    if (!job.account.credential) throw new AppError('Credentials were disconnected', 409);
    if (job.account.organization.demo)
      throw new AppError(
        'Live synchronization is disabled in synthetic demo workspaces. Select a real workspace.',
        409,
      );
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: 'running', startedAt: now, error: null },
    });
    const client = adapter(
      job.account.providerId as ProviderId,
      decrypt<Credentials>(job.account.credential.ciphertext),
    );
    for await (const page of client.pages()) {
      const counts = await db.$transaction(
        async (tx) => {
          let pageAdded = 0;
          let pageUpdated = 0;
          await lockWorkspaceOwner(tx, job.account.organizationId);
          if (job.requestedBy)
            await lockWorkspaceMembershipForActor(
              tx,
              job.account.organizationId,
              job.requestedBy,
              'EDITOR',
              false,
              'sync',
            );
          const lease = await tx.providerAccount.findFirst({
            where: {
              id: job.account.id,
              lockOwner: job.id,
              credential: { ciphertext: job.account.credential!.ciphertext },
            },
          });
          if (!lease)
            throw new AppError('Sync lease expired or credentials were disconnected', 409);
          const normalized = page.map((item) => ({ ...item, ...normalizeDomain(item.name) }));
          const names = await tx.domain.findMany({
            where: {
              organizationId: job.account.organizationId,
              name: { in: normalized.map((d) => d.name) },
            },
            select: { id: true, name: true },
          });
          const set = new Set(names.map((d) => d.name));
          const missing = new Map(
            normalized.filter((d) => !set.has(d.name)).map((d) => [d.name, d]),
          );
          // Create each new domain once per provider page.
          const newDomains = [...missing.values()];
          for (let offset = 0; offset < newDomains.length; offset += 500) {
            await tx.domain.createMany({
              data: newDomains.slice(offset, offset + 500).map((remote) => ({
                organizationId: job.account.organizationId,
                name: remote.name,
                unicodeName: remote.unicodeName,
                tld: remote.tld,
                source: job.account.providerId,
                confidence: 'provider-verified',
              })),
              skipDuplicates: true,
            });
          }
          const byName = new Map(names.map((d) => [d.name, d.id]));
          for (let offset = 0; offset < newDomains.length; offset += 500) {
            const created = await tx.domain.findMany({
              where: {
                organizationId: job.account.organizationId,
                name: { in: newDomains.slice(offset, offset + 500).map((d) => d.name) },
              },
              select: { id: true, name: true },
            });
            for (const domain of created) byName.set(domain.name, domain.id);
          }
          // Batch only unique, previously absent registration keys. Existing
          // records and duplicate keys retain the sequential upsert behavior,
          // including Prisma's undefined-versus-null update semantics.
          const registrationKey = (domainId: string, registrar: string) =>
            JSON.stringify([domainId, registrar]);
          const registrationCounts = new Map<string, number>();
          const registrationIds = new Set<string>();
          for (const remote of normalized) {
            if (!remote.registrar) continue;
            const domainId = byName.get(remote.name);
            if (!domainId) throw new AppError('Unable to persist the synchronized domain.', 503);
            const key = registrationKey(domainId, remote.registrar);
            registrationCounts.set(key, (registrationCounts.get(key) ?? 0) + 1);
            registrationIds.add(domainId);
          }
          const existingRegistrationKeys = new Set<string>();
          const registrationDomainIds = [...registrationIds];
          for (let offset = 0; offset < registrationDomainIds.length; offset += 500) {
            const registrations = await tx.domainRegistration.findMany({
              where: { domainId: { in: registrationDomainIds.slice(offset, offset + 500) } },
              select: { domainId: true, registrar: true },
            });
            for (const registration of registrations)
              existingRegistrationKeys.add(
                registrationKey(registration.domainId, registration.registrar),
              );
          }
          const newRegistrations = normalized.flatMap((remote) => {
            if (!remote.registrar) return [];
            const domainId = byName.get(remote.name)!;
            const key = registrationKey(domainId, remote.registrar);
            if (registrationCounts.get(key) !== 1 || existingRegistrationKeys.has(key)) return [];
            return [
              {
                domainId,
                registrar: remote.registrar,
                providerAccountId: job.account.id,
                expiresAt: remote.expiresAt ? new Date(remote.expiresAt) : undefined,
                registeredAt: remote.registeredAt ? new Date(remote.registeredAt) : undefined,
                autoRenew: remote.autoRenew,
                nameservers: remote.nameservers ?? [],
                source: job.account.providerId,
                verifiedAt: now,
              },
            ];
          });
          const insertedRegistrationKeys = new Set<string>();
          for (let offset = 0; offset < newRegistrations.length; offset += 500) {
            const inserted = await tx.domainRegistration.createManyAndReturn({
              data: newRegistrations.slice(offset, offset + 500),
              skipDuplicates: true,
              select: { domainId: true, registrar: true },
            });
            // A concurrent insertion may have won despite the initial read;
            // its key is not returned and falls back to the normal upsert.
            for (const registration of inserted)
              insertedRegistrationKeys.add(
                registrationKey(registration.domainId, registration.registrar),
              );
          }
          // Read existing listing state once per bounded chunk. Keep the map
          // current after each upsert so duplicate domains in a provider page
          // retain the original sequential price-history and analytics behavior.
          const listingDomainIds = [
            ...new Set(
              normalized
                .filter((remote) => remote.marketplace)
                .map((remote) => byName.get(remote.name))
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          const listingState = new Map<
            string,
            { binPrice: Prisma.Decimal | null; analytics: Prisma.JsonValue | null }
          >();
          for (let offset = 0; offset < listingDomainIds.length; offset += 500) {
            const listings = await tx.domainListing.findMany({
              where: { domainId: { in: listingDomainIds.slice(offset, offset + 500) } },
              select: { domainId: true, marketplace: true, binPrice: true, analytics: true },
            });
            for (const listing of listings)
              listingState.set(JSON.stringify([listing.domainId, listing.marketplace]), listing);
          }
          // Only first-time, unique listing keys can be inserted out of order.
          // Duplicates and existing rows retain sequential price and analytics updates.
          const listingCounts = new Map<string, number>();
          for (const remote of normalized) {
            if (!remote.marketplace) continue;
            const domainId = byName.get(remote.name)!;
            const key = JSON.stringify([domainId, remote.marketplace]);
            listingCounts.set(key, (listingCounts.get(key) ?? 0) + 1);
          }
          const newListings = normalized.flatMap((remote) => {
            if (!remote.marketplace) return [];
            const domainId = byName.get(remote.name)!;
            const key = JSON.stringify([domainId, remote.marketplace]);
            if (listingCounts.get(key) !== 1 || listingState.has(key)) return [];
            return [
              {
                domainId,
                marketplace: remote.marketplace,
                providerAccountId: job.account.id,
                binPrice: remote.binPrice ?? null,
                minOffer: remote.minOffer ?? null,
                currency: remote.currency ?? 'USD',
                status: remote.status ?? 'unknown',
                verifiedAt: now,
                stale: false,
                source: job.account.providerId,
                lto: remote.lto ? JSON.parse(JSON.stringify(remote.lto)) : Prisma.DbNull,
                analytics:
                  remote.analytics && Object.values(remote.analytics).some((v) => v !== undefined)
                    ? JSON.parse(
                        JSON.stringify({ ...remote.analytics, observedAt: now.toISOString() }),
                      )
                    : undefined,
              },
            ];
          });
          const insertedListingKeys = new Set<string>();
          for (let offset = 0; offset < newListings.length; offset += 500) {
            const chunk = newListings.slice(offset, offset + 500);
            const inserted = await tx.domainListing.createManyAndReturn({
              data: chunk,
              skipDuplicates: true,
              select: { domainId: true, marketplace: true },
            });
            for (const listing of inserted)
              insertedListingKeys.add(JSON.stringify([listing.domainId, listing.marketplace]));
            const histories = chunk.flatMap((listing) =>
              insertedListingKeys.has(JSON.stringify([listing.domainId, listing.marketplace])) &&
              String(listing.binPrice ?? '') !== ''
                ? [
                    {
                      domainId: listing.domainId,
                      marketplace: listing.marketplace,
                      price: listing.binPrice,
                      currency: listing.currency,
                      source: job.account.providerId,
                    },
                  ]
                : [],
            );
            if (histories.length) await tx.domainPriceHistory.createMany({ data: histories });
            const conflicts = chunk.filter(
              (listing) =>
                !insertedListingKeys.has(JSON.stringify([listing.domainId, listing.marketplace])),
            );
            if (conflicts.length) {
              const current = await tx.domainListing.findMany({
                where: {
                  OR: conflicts.map(({ domainId, marketplace }) => ({ domainId, marketplace })),
                },
                select: { domainId: true, marketplace: true, binPrice: true, analytics: true },
              });
              for (const listing of current)
                listingState.set(JSON.stringify([listing.domainId, listing.marketplace]), listing);
            }
          }
          for (const remote of normalized) {
            const domainId = byName.get(remote.name);
            if (!domainId) throw new AppError('Unable to persist the synchronized domain.', 503);
            if (set.has(remote.name)) pageUpdated++;
            else {
              pageAdded++;
              set.add(remote.name);
            }
            if (
              remote.registrar &&
              !insertedRegistrationKeys.has(registrationKey(domainId, remote.registrar))
            )
              await tx.domainRegistration.upsert({
                where: { domainId_registrar: { domainId, registrar: remote.registrar } },
                create: {
                  domainId,
                  registrar: remote.registrar,
                  providerAccountId: job.account.id,
                  expiresAt: remote.expiresAt ? new Date(remote.expiresAt) : undefined,
                  registeredAt: remote.registeredAt ? new Date(remote.registeredAt) : undefined,
                  autoRenew: remote.autoRenew,
                  nameservers: remote.nameservers ?? [],
                  source: job.account.providerId,
                  verifiedAt: now,
                },
                update: {
                  providerAccountId: job.account.id,
                  expiresAt: remote.expiresAt ? new Date(remote.expiresAt) : undefined,
                  registeredAt: remote.registeredAt ? new Date(remote.registeredAt) : undefined,
                  autoRenew: remote.autoRenew,
                  nameservers: remote.nameservers,
                  source: job.account.providerId,
                  verifiedAt: now,
                },
              });
            if (
              remote.marketplace &&
              !insertedListingKeys.has(JSON.stringify([domainId, remote.marketplace]))
            ) {
              const listingKey = JSON.stringify([domainId, remote.marketplace]);
              const previous = listingState.get(listingKey);
              const data = {
                providerAccountId: job.account.id,
                binPrice: remote.binPrice ?? null,
                minOffer: remote.minOffer ?? null,
                currency: remote.currency ?? 'USD',
                status: remote.status ?? 'unknown',
                verifiedAt: now,
                stale: false,
                source: job.account.providerId,
                lto: remote.lto ? JSON.parse(JSON.stringify(remote.lto)) : Prisma.DbNull,
                analytics:
                  remote.analytics && Object.values(remote.analytics).some((v) => v !== undefined)
                    ? JSON.parse(
                        JSON.stringify({
                          ...(previous?.analytics && typeof previous.analytics === 'object'
                            ? previous.analytics
                            : {}),
                          ...remote.analytics,
                          observedAt: now.toISOString(),
                        }),
                      )
                    : undefined,
              };
              const saved = await tx.domainListing.upsert({
                where: {
                  domainId_marketplace: { domainId, marketplace: remote.marketplace },
                },
                create: { domainId, marketplace: remote.marketplace, ...data },
                update: data,
              });
              listingState.set(listingKey, saved);
              if (String(previous?.binPrice ?? '') !== (remote.binPrice ?? ''))
                await tx.domainPriceHistory.create({
                  data: {
                    domainId,
                    marketplace: remote.marketplace,
                    previousPrice: previous?.binPrice,
                    price: remote.binPrice ?? null,
                    currency: remote.currency ?? 'USD',
                    source: job.account.providerId,
                  },
                });
            }
          }
          const itemNames = [...new Set(normalized.map((remote) => remote.name))];
          for (let offset = 0; offset < itemNames.length; offset += 500) {
            const chunk = itemNames.slice(offset, offset + 500);
            await tx.syncJobItem.createMany({
              data: chunk.map((domainName) => ({ jobId: job.id, domainName, status: 'verified' })),
              skipDuplicates: true,
            });
            await tx.syncJobItem.updateMany({
              where: { jobId: job.id, domainName: { in: chunk } },
              data: { status: 'verified' },
            });
          }
          await tx.syncJob.update({
            where: { id: job.id },
            data: { added: added + pageAdded, updated: updated + pageUpdated },
          });
          return { pageAdded, pageUpdated };
        },
        { timeout: 60000 },
      );
      added += counts.pageAdded;
      updated += counts.pageUpdated;
    }
    const warnings: string[] = [];
    if (client.sales) {
      try {
        for await (const page of client.sales()) {
          await db.$transaction(async (tx) => {
            await lockWorkspaceOwner(tx, job.account.organizationId);
            if (job.requestedBy)
              await lockWorkspaceMembershipForActor(
                tx,
                job.account.organizationId,
                job.requestedBy,
                'EDITOR',
                false,
                'sync',
              );
            const lease = await tx.providerAccount.findFirst({
              where: {
                id: job.account.id,
                lockOwner: job.id,
                credential: { ciphertext: job.account.credential!.ciphertext },
              },
            });
            if (!lease) throw new AppError('Connection changed or lease expired', 409);
            for (const sale of page) {
              const normalized = {
                ...sale,
                domainName: normalizeDomain(sale.domainName).name,
                soldAt:
                  sale.soldAt && !Number.isNaN(Date.parse(sale.soldAt))
                    ? new Date(sale.soldAt)
                    : null,
                observedAt: new Date(),
                nextInstallmentAt:
                  sale.nextInstallmentAt && !Number.isNaN(Date.parse(sale.nextInstallmentAt))
                    ? new Date(sale.nextInstallmentAt)
                    : null,
                previousInstallmentAt:
                  sale.previousInstallmentAt &&
                  !Number.isNaN(Date.parse(sale.previousInstallmentAt))
                    ? new Date(sale.previousInstallmentAt)
                    : null,
                disbursedAt:
                  sale.disbursedAt && !Number.isNaN(Date.parse(sale.disbursedAt))
                    ? new Date(sale.disbursedAt)
                    : null,
              };
              await tx.providerSaleObservation.upsert({
                where: {
                  providerAccountId_externalId: {
                    providerAccountId: job.account.id,
                    externalId: sale.externalId,
                  },
                },
                create: { providerAccountId: job.account.id, ...normalized },
                update: normalized,
              });
            }
          });
        }
      } catch (error) {
        warnings.push(`Sales feed: ${safeProviderError(error)}`);
      }
    }
    if (client.stats) {
      try {
        const stats = await client.stats();
        await db.$transaction(async (tx) => {
          await lockWorkspaceOwner(tx, job.account.organizationId);
          if (job.requestedBy)
            await lockWorkspaceMembershipForActor(
              tx,
              job.account.organizationId,
              job.requestedBy,
              'EDITOR',
              false,
              'sync',
            );
          const lease = await tx.providerAccount.findFirst({
            where: {
              id: job.account.id,
              lockOwner: job.id,
              credential: { ciphertext: job.account.credential!.ciphertext },
            },
          });
          if (!lease) throw new AppError('Connection changed or lease expired', 409);
          for (const item of stats) {
            const data = {
              date: new Date(item.date),
              views: item.views,
              leads: item.leads,
              observedAt: new Date(),
            };
            await tx.providerAnalytics.upsert({
              where: {
                providerAccountId_date: { providerAccountId: job.account.id, date: data.date },
              },
              create: { providerAccountId: job.account.id, ...data },
              update: data,
            });
          }
        });
      } catch (error) {
        // Preserve existing analytics if access is lost.
        if (!(error instanceof AppError && error.status === 403))
          warnings.push(`Analytics feed: ${safeProviderError(error)}`);
      }
    }
    await db.$transaction(async (tx) => {
      await lockWorkspaceOwner(tx, job.account.organizationId);
      if (job.requestedBy)
        await lockWorkspaceMembershipForActor(
          tx,
          job.account.organizationId,
          job.requestedBy,
          'EDITOR',
          false,
          'sync',
        );
      const lease = await tx.providerAccount.findFirst({
        where: {
          id: job.account.id,
          lockOwner: job.id,
          credential: { ciphertext: job.account.credential!.ciphertext },
        },
      });
      if (!lease) throw new AppError('Connection changed or lease expired', 409);
      await tx.domainListing.updateMany({
        where: {
          providerAccountId: job.account.id,
          OR: [{ verifiedAt: { lt: now } }, { verifiedAt: null }],
        },
        data: { stale: true },
      });
      await tx.providerAccount.update({
        where: { id: job.account.id },
        data: { lastSyncAt: new Date(), status: 'connected' },
      });
      await tx.providerSyncState.upsert({
        where: { providerAccountId: job.account.id },
        create: { providerAccountId: job.account.id, lastSuccessAt: new Date() },
        update: { lastSuccessAt: new Date() },
      });
      await tx.syncJob.update({
        where: { id: job.id },
        data: {
          status: warnings.length ? 'partial' : 'completed',
          finishedAt: new Date(),
          added,
          updated,
          error: warnings.length ? warnings.join('; ') : null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: job.account.organizationId,
          actorId: 'worker',
          action: warnings.length ? 'sync.partial' : 'sync.completed',
          entityId: job.id,
          detail: { added, updated },
        },
      });
      if (job.requestedBy)
        await queueActivityNotice(tx, {
          eventId: `sync:${job.id}`,
          category: 'sync',
          organizationId: job.account.organizationId,
          recipientId: job.requestedBy,
          title: warnings.length ? 'Provider sync needs review' : 'Provider sync completed',
          message: warnings.length
            ? 'Some information could not be refreshed. Open Activity Center for details.'
            : `The sync added ${added} and updated ${updated} records.`,
        });
      for (const message of warnings)
        await tx.integrationError.create({
          data: { jobId: job.id, code: 'OPTIONAL_FEED_UNAVAILABLE', message },
        });
    });
  } catch (e) {
    void reportError('worker');
    const message = safeProviderError(e);
    await db.$transaction([
      db.syncJob.update({
        where: { id: job.id },
        data: {
          status: added + updated ? 'partial' : 'failed',
          error: message,
          finishedAt: new Date(),
        },
      }),
      db.integrationError.create({ data: { jobId: job.id, code: 'SYNC_FAILED', message } }),
      db.providerAccount.update({ where: { id: job.account.id }, data: { status: 'error' } }),
    ]);
    throw e;
  } finally {
    clearInterval(heartbeat);
    await db.providerAccount.updateMany({
      where: { id: job.providerAccountId, lockOwner: job.id },
      data: { lockedUntil: null, lockOwner: null },
    });
  }
}
