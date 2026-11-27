import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { lockWritableWorkspace, lockWritableWorkspaceForActor } from './workspace-write';
import { decrypt, AppError, safeProviderError } from './security';
import { requireRole } from './permissions';
import type { Context } from './access';
import { audit } from './portfolio';
import {
  providers,
  isAvailableProvider,
  assertCapability,
  type ProviderId,
} from '@/integrations/catalog';
import {
  AtomPriceRejection,
  priceClient,
  samePrice,
  validateListingPrice,
  type PriceProvider,
} from '@/integrations/prices';
import type { Credentials } from '@/integrations/adapters';
import { canEditListingPrice } from '@/integrations/listing-status';
import { sleep } from '@/integrations/http';
import { throttle } from './throttle';
import { queueActivityNotice } from './activity-notices';
export function requirePublishing(org: { demo: boolean; pricePublishingEnabled: boolean }) {
  if (process.env.PROVIDER_WRITES_ENABLED !== 'true' || !org.pricePublishingEnabled || org.demo)
    throw new AppError(
      'Enable provider price publishing in workspace settings before confirming a change.',
      403,
    );
}
export async function previewListingPrice(
  ctx: Context,
  listingId: string,
  newPrice: string,
  expectedCurrency?: string,
) {
  requireRole(ctx);
  const listing = await db.domainListing.findFirst({
    where: { id: listingId, domain: { organizationId: ctx.org.id, deletedAt: null } },
    include: { domain: true, account: { include: { credential: true } } },
  });
  if (!listing?.account?.credential || listing.account.organizationId !== ctx.org.id)
    throw new AppError('This listing needs a connected provider account', 409);
  const provider = listing.account.providerId as ProviderId;
  if (expectedCurrency && listing.currency !== expectedCurrency)
    throw new AppError(
      'Listing currency differs from the portfolio currency. Edit this price separately.',
      409,
    );
  await throttle(`price-preview:${ctx.org.id}:${listing.account.id}`, 30);
  if (!isAvailableProvider(provider)) throw new AppError('Provider unavailable', 409);
  assertCapability(provider, 'updatePrices');
  validateListingPrice(provider, newPrice, listing.currency);
  if (ctx.org.demo) throw new AppError('Demo listings cannot be published', 403);
  const remote = await priceClient(
    provider as PriceProvider,
    decrypt<Credentials>(listing.account.credential.ciphertext),
  ).read(listing.domain.name);
  if (remote.currency !== listing.currency)
    throw new AppError('Remote currency changed. Synchronize before editing.', 409);
  if (samePrice(remote.price, newPrice))
    throw new AppError('The remote listing already has this price');
  if (!canEditListingPrice(provider, remote.status))
    throw new AppError(
      `This listing is not currently active (${remote.status}). Review it at the provider.`,
      409,
    );
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', true);
    const change = await tx.listingPriceChange.create({
      data: {
        organizationId: ctx.org.id,
        providerAccountId: listing.account!.id,
        listingId: listing.id,
        requestedBy: ctx.user.id!,
        oldPrice: remote.price,
        newPrice,
        currency: remote.currency,
        remoteStatus: remote.status,
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    await audit(tx, ctx, 'listing.price_previewed', listing.id, {
      previousPrice: remote.price,
      newPrice,
      currency: remote.currency,
      provider,
    });
    return { ...change, domainName: remote.name, provider: providers[provider].name };
  });
}
export const maxPricePreviewBatch = 12;

export async function previewMarketplacePrices(ctx: Context, listingId: string, newPrice: string) {
  requireRole(ctx);
  const domain = await db.domain.findFirst({
    where: {
      organizationId: ctx.org.id,
      deletedAt: null,
      status: 'active',
      listings: { some: { id: listingId } },
    },
    select: {
      name: true,
      currency: true,
      listings: {
        select: { id: true, marketplace: true },
        orderBy: { marketplace: 'asc' },
        take: maxPricePreviewBatch + 1,
      },
    },
  });
  if (!domain) throw new AppError('Active domain listing not found', 404);
  if (domain.listings.length > maxPricePreviewBatch)
    throw new AppError('Too many listings to preview together. Edit them individually.', 409);
  const previews = await Promise.all(
    domain.listings.map(async (listing) => {
      try {
        const preview = await previewListingPrice(ctx, listing.id, newPrice, domain.currency);
        return { provider: preview.provider, preview, reason: null };
      } catch (error) {
        const provider = Object.hasOwn(providers, listing.marketplace)
          ? providers[listing.marketplace as ProviderId].name
          : listing.marketplace;
        return { provider, preview: null, reason: safeProviderError(error) };
      }
    }),
  );
  return { domainName: domain.name, currency: domain.currency, newPrice, previews };
}

export async function confirmListingPrice(ctx: Context, id: string) {
  const [job] = await confirmMarketplacePrices(ctx, [id], false);
  return job;
}

export async function confirmMarketplacePrices(
  ctx: Context,
  ids: string[],
  updateAskingPrice = true,
) {
  requireRole(ctx);
  requirePublishing(ctx.org);
  if (!ids.length || ids.length > maxPricePreviewBatch || new Set(ids).size !== ids.length)
    throw new AppError('Select valid price previews to confirm.', 400);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', true);
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    requirePublishing(organization);
    const changes = await tx.listingPriceChange.findMany({
      where: { id: { in: ids }, organizationId: ctx.org.id, requestedBy: ctx.user.id! },
      include: { listing: { include: { domain: true } }, account: true },
      orderBy: [{ providerAccountId: 'asc' }, { id: 'asc' }],
    });
    if (changes.length !== ids.length) throw new AppError('Price preview not found', 404);
    if (changes.some((change) => !isAvailableProvider(change.account.providerId)))
      throw new AppError('Provider unavailable', 409);
    const [first] = changes;
    const domain = first.listing.domain;
    if (changes.some((change) => change.status !== 'preview' || change.expiresAt <= new Date()))
      throw new AppError('Preview expired or already confirmed. Create a new preview.', 409);
    if (
      domain.organizationId !== ctx.org.id ||
      domain.deletedAt ||
      domain.status !== 'active' ||
      new Set(changes.map((change) => change.listingId)).size !== changes.length ||
      changes.some(
        (change) =>
          change.listing.domainId !== domain.id ||
          change.listing.providerAccountId !== change.providerAccountId ||
          change.account.organizationId !== ctx.org.id ||
          !change.newPrice.eq(first.newPrice) ||
          (updateAskingPrice && change.currency !== domain.currency),
      )
    )
      throw new AppError('The listings changed. Create a new price preview.', 409);
    const jobs = [];
    const notificationGroup = changes.length > 1 ? randomUUID() : null;
    for (const change of changes) {
      await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${change.providerAccountId} FOR UPDATE`;
      const reserved = await tx.listingPriceChange.updateMany({
        where: { id: change.id, status: 'preview', expiresAt: { gt: new Date() } },
        data: { status: 'queued', confirmedAt: new Date(), notificationGroup },
      });
      if (!reserved.count) throw new AppError('Price preview expired or already confirmed.', 409);
      const job = await tx.syncJob.create({
        data: { providerAccountId: change.providerAccountId, kind: 'price' },
      });
      await tx.listingPriceChange.update({ where: { id: change.id }, data: { syncJobId: job.id } });
      await audit(tx, ctx, 'listing.price_confirmed', change.listingId, {
        newPrice: change.newPrice.toString(),
        jobId: job.id,
      });
      jobs.push({ jobId: job.id, changeId: change.id });
    }
    if (updateAskingPrice && !domain.askingPrice?.eq(first.newPrice)) {
      await tx.domain.update({ where: { id: domain.id }, data: { askingPrice: first.newPrice } });
      await tx.domainPriceHistory.create({
        data: {
          domainId: domain.id,
          marketplace: 'Internal asking price',
          previousPrice: domain.askingPrice,
          price: first.newPrice,
          currency: domain.currency,
          source: 'manual',
        },
      });
      await audit(tx, ctx, 'domain.asking_price_updated', domain.id, {
        previousPrice: domain.askingPrice?.toString() ?? null,
        newPrice: first.newPrice.toString(),
        syncMarketplaces: true,
      });
    }
    return jobs;
  });
}

async function lockPriceNoticeGroup(tx: Prisma.TransactionClient, group: string | null) {
  if (group) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${group}, 0))::text`;
}

async function queuePriceGroupNotice(
  tx: Prisma.TransactionClient,
  group: string,
  organizationId: string,
  recipientId: string,
  domainName: string,
) {
  const changes = await tx.listingPriceChange.findMany({
    where: { notificationGroup: group, organizationId, requestedBy: recipientId },
    select: { status: true, error: true, account: { select: { providerId: true } } },
    orderBy: { account: { providerId: 'asc' } },
  });
  if (
    !changes.length ||
    changes.some(({ status }) => !['completed', 'failed', 'unverified'].includes(status))
  )
    return;
  const verified = changes.filter(({ status }) => status === 'completed').length;
  const results = changes.map(({ account, status, error }) => {
    const provider =
      account.providerId === 'spaceship'
        ? 'SellerHub'
        : (providers[account.providerId as ProviderId]?.name ?? 'Marketplace');
    if (status === 'completed') return `${provider} verified.`;
    const outcome = status === 'failed' ? 'failed' : 'needs verification';
    return `${provider} ${outcome}.${error ? ` ${error.slice(0, 220)}` : ''}`;
  });
  await queueActivityNotice(tx, {
    eventId: `price-group:${group}`,
    category: 'price',
    organizationId,
    recipientId,
    title:
      verified === changes.length
        ? 'Marketplace prices updated'
        : 'Marketplace price update results',
    message: [
      `${domainName} · ${verified} of ${changes.length} marketplace prices verified.`,
      ...results,
    ].join('\n'),
  });
}
export async function runListingPriceJob(jobId: string) {
  const change = await db.listingPriceChange.findUnique({
    where: { syncJobId: jobId },
    include: {
      organization: true,
      listing: { include: { domain: true } },
      account: { include: { credential: true } },
    },
  });
  if (!change || ['completed', 'failed', 'unverified'].includes(change.status)) return;
  const claim = await db.providerAccount.updateMany({
    where: {
      id: change.providerAccountId,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    data: { lockOwner: jobId, lockedUntil: new Date(Date.now() + 600000) },
  });
  if (!claim.count) throw new AppError('Account is already synchronizing', 503);
  const heartbeat = setInterval(() => {
    void db.providerAccount
      .updateMany({
        where: { id: change.providerAccountId, lockOwner: jobId },
        data: { lockedUntil: new Date(Date.now() + 600000) },
      })
      .catch(() => undefined);
  }, 30000);
  let attempted = change.status === 'executing';
  try {
    const state = await db.listingPriceChange.findUnique({
      where: { id: change.id },
      select: { status: true },
    });
    if (!state || !['queued', 'executing'].includes(state.status)) return;
    attempted = state.status === 'executing';
    requirePublishing(change.organization);
    const member = await db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: change.organizationId,
          userId: change.requestedBy,
        },
      },
    });
    if (!member) throw new AppError('Requester no longer belongs to this workspace', 403);
    requireRole(member);
    if (!isAvailableProvider(change.account.providerId))
      throw new AppError('Provider unavailable', 409);
    assertCapability(change.account.providerId, 'updatePrices');
    if (!change.account.credential) throw new AppError('Provider was disconnected', 409);
    if (change.account.credential.updatedAt >= change.createdAt)
      throw new AppError('Credentials changed since preview. Create a fresh preview.', 409);
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date() },
    });
    const client = priceClient(
      change.account.providerId as PriceProvider,
      decrypt<Credentials>(change.account.credential.ciphertext),
    );
    let current = await client.read(change.listing.domain.name);
    if (!samePrice(current.price, change.newPrice.toString())) {
      if (attempted)
        throw new AppError(
          'An earlier update could not be verified. Synchronize and create a fresh preview; no automatic republishing was attempted.',
          409,
        );
      if (
        current.currency !== change.currency ||
        current.status !== change.remoteStatus ||
        !samePrice(current.price, change.oldPrice?.toString() ?? null)
      )
        throw new AppError(
          'Remote listing changed since the preview. Create a new preview; nothing was published.',
          409,
        );
      // Persist intent independently: a process crash or transaction timeout must never replay
      // an update that might already have reached the provider.
      await db.listingPriceChange.update({
        where: { id: change.id },
        data: { status: 'executing' },
      });
      try {
        await db.$transaction(
          async (tx) => {
            // Leave ample time for the bounded provider request before Prisma can
            // expire the transaction and release its authorization locks.
            const sendDeadline = performance.now() + 40000;
            await lockWritableWorkspaceForActor(
              tx,
              change.organizationId,
              change.requestedBy,
              'EDITOR',
              true,
            );
            const organization = await tx.organization.findUniqueOrThrow({
              where: { id: change.organizationId },
            });
            requirePublishing(organization);
            await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id = ${change.providerAccountId} FOR UPDATE`;
            const account = await tx.providerAccount.findFirst({
              where: {
                id: change.providerAccountId,
                organizationId: change.organizationId,
                lockOwner: jobId,
                lockedUntil: { gt: new Date() },
              },
              include: { credential: true },
            });
            const listing = await tx.domainListing.findFirst({
              where: {
                id: change.listingId,
                providerAccountId: change.providerAccountId,
                domain: {
                  organizationId: change.organizationId,
                  deletedAt: null,
                  status: 'active',
                },
              },
            });
            if (
              !listing ||
              !account?.credential ||
              account.credential.ciphertext !== change.account.credential!.ciphertext ||
              account.credential.updatedAt >= change.createdAt
            )
              throw new AppError(
                'Listing, credentials, or execution lease changed. Create a fresh preview.',
                409,
              );
            if (performance.now() >= sendDeadline)
              throw new AppError(
                'Provider authorization timed out before sending. Try again.',
                503,
              );
            attempted = true;
            await client.update(
              change.listing.domain.name,
              change.newPrice.toString(),
              change.currency,
            );
          },
          { timeout: 90000, maxWait: 10000 },
        );
      } catch (error) {
        if (error instanceof AtomPriceRejection) attempted = false;
        throw error;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt) await sleep(1000);
        current = await client.read(change.listing.domain.name);
        if (
          current.currency === change.currency &&
          samePrice(current.price, change.newPrice.toString())
        )
          break;
      }
    }
    if (
      current.currency !== change.currency ||
      !samePrice(current.price, change.newPrice.toString())
    )
      throw new AppError(
        change.account.providerId === 'atom' && current.listingType?.toLowerCase() === 'premium'
          ? 'Atom still reports a different price. Check the allowed price range for this Premium listing and your API pricing access in Atom before retrying.'
          : 'Provider has not confirmed the requested price. Synchronize before trying again.',
        502,
      );
    await db.$transaction(async (tx) => {
      await lockPriceNoticeGroup(tx, change.notificationGroup);
      await tx.domainListing.update({
        where: { id: change.listingId },
        data: {
          binPrice: current.price,
          currency: current.currency,
          status: current.status,
          verifiedAt: new Date(),
          source: change.account.providerId,
          stale: false,
        },
      });
      await tx.domainPriceHistory.create({
        data: {
          domainId: change.listing.domainId,
          marketplace: change.listing.marketplace,
          previousPrice: change.oldPrice,
          price: change.newPrice,
          currency: change.currency,
          source: 'confirmed-provider-update',
        },
      });
      await tx.listingPriceChange.update({
        where: { id: change.id },
        data: { status: 'completed', verifiedAt: new Date(), error: null },
      });
      await tx.syncJob.update({
        where: { id: jobId },
        data: { status: 'completed', finishedAt: new Date(), updated: 1 },
      });
      await tx.syncJobItem.upsert({
        where: { jobId_domainName: { jobId, domainName: change.listing.domain.name } },
        create: {
          jobId,
          domainName: change.listing.domain.name,
          status: 'verified',
          message: 'Provider BIN price re-read and matched the confirmed change',
        },
        update: { status: 'verified' },
      });
      await tx.auditLog.create({
        data: {
          organizationId: change.organizationId,
          actorId: change.requestedBy,
          action: 'listing.price_verified',
          entityId: change.listingId,
          detail: {
            previousPrice: change.oldPrice?.toString() ?? null,
            newPrice: change.newPrice.toString(),
            currency: change.currency,
            provider: change.account.providerId,
          },
        },
      });
      if (change.notificationGroup)
        await queuePriceGroupNotice(
          tx,
          change.notificationGroup,
          change.organizationId,
          change.requestedBy,
          change.listing.domain.name,
        );
      else
        await queueActivityNotice(tx, {
          eventId: `price:${change.id}`,
          category: 'price',
          organizationId: change.organizationId,
          recipientId: change.requestedBy,
          title: 'Marketplace price updated',
          message: `The new marketplace price for ${change.listing.domain.name} was verified.`,
        });
    });
  } catch (error) {
    const message = safeProviderError(error);
    await db.$transaction(async (tx) => {
      await lockPriceNoticeGroup(tx, change.notificationGroup);
      if (attempted)
        await tx.domainListing.updateMany({
          where: { id: change.listingId },
          data: { stale: true },
        });
      await tx.listingPriceChange.update({
        where: { id: change.id },
        data: { status: attempted ? 'unverified' : 'failed', error: message },
      });
      await tx.syncJob.update({
        where: { id: jobId },
        data: {
          status: attempted ? 'unverified' : 'failed',
          error: message,
          finishedAt: new Date(),
        },
      });
      await tx.integrationError.create({
        data: { jobId, code: attempted ? 'PRICE_NOT_VERIFIED' : 'PRICE_NOT_PUBLISHED', message },
      });
      await tx.auditLog.create({
        data: {
          organizationId: change.organizationId,
          actorId: change.requestedBy,
          action: attempted ? 'listing.price_unverified' : 'listing.price_failed',
          entityId: change.listingId,
          detail: {
            previousPrice: change.oldPrice?.toString() ?? null,
            newPrice: change.newPrice.toString(),
            currency: change.currency,
            jobId,
          },
        },
      });
      if (change.notificationGroup)
        await queuePriceGroupNotice(
          tx,
          change.notificationGroup,
          change.organizationId,
          change.requestedBy,
          change.listing.domain.name,
        );
      else if (change.account.providerId === 'atom')
        await queueActivityNotice(tx, {
          eventId: `price:${change.id}`,
          category: 'price',
          organizationId: change.organizationId,
          recipientId: change.requestedBy,
          title: attempted ? 'Atom price change needs review' : 'Atom price change failed',
          message: `${change.listing.domain.name}. ${message}`,
        });
    });
  } finally {
    clearInterval(heartbeat);
    await db.providerAccount.updateMany({
      where: { id: change.providerAccountId, lockOwner: jobId },
      data: { lockOwner: null, lockedUntil: null },
    });
  }
}
