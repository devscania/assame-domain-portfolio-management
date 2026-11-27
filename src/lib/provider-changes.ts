import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { db } from './db';
import { lockWritableWorkspace, lockWritableWorkspaceForActor } from './workspace-write';
import { AppError, decrypt, safeProviderError } from './security';
import { requireRole } from './permissions';
import { throttle } from './throttle';
import { audit } from './portfolio';
import type { Context } from './access';
import type { Credentials } from '@/integrations/adapters';
import { isAvailableProvider, providers, type ProviderId } from '@/integrations/catalog';
import {
  actionClient,
  actionInput,
  type ActionInput,
  ProviderMutationNotSentError,
} from '@/integrations/actions';
import { validateListingPrice } from '@/integrations/prices';
import { sleep } from '@/integrations/http';
import { nameserverEligibleAccounts, supportsNameserverChanges } from './nameserver-policy';
import { queueActivityNotice } from './activity-notices';
import { listingNeedsReview } from '@/integrations/listing-status';

export function requireProviderActions(org: { demo: boolean; providerActionsEnabled: boolean }) {
  if (process.env.PROVIDER_WRITES_ENABLED !== 'true' || !org.providerActionsEnabled || org.demo)
    throw new AppError('Enable provider actions in workspace settings before confirming.', 403);
}
function capability(provider: ProviderId, action: ActionInput['action']) {
  if (!isAvailableProvider(provider)) throw new AppError('Provider unavailable', 409);
  if (action === 'removeListing') {
    if (!providers[provider]?.capabilities.removeListings)
      throw new AppError('This provider does not support delisting in Assame.', 409);
    return;
  }
  if (action === 'changeNameservers') {
    if (!supportsNameserverChanges(provider))
      throw new AppError('Nameserver changes are only supported for Namecheap and Spaceship.', 409);
    return;
  }
  if (!providers[provider]?.capabilities.addListings)
    throw new AppError('This provider does not support this operation in Assame.', 409);
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function sameSnapshot(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
const nameserverSnapshot = z.object({
  remote: z.union([
    z.array(z.string()),
    z.object({ provider: z.enum(['basic', 'custom']), hosts: z.array(z.string()) }),
  ]),
  registration: z.object({
    id: z.string(),
    registrar: z.string(),
    source: z.string(),
    providerAccountId: z.string(),
    verifiedAt: z.string(),
  }),
});
function sameRegistrarBinding(
  saved: z.infer<typeof nameserverSnapshot>['registration'],
  current: z.infer<typeof nameserverSnapshot>['registration'],
  allowNewerObservation = false,
) {
  if (!allowNewerObservation) return sameSnapshot(saved, current);
  const { verifiedAt: savedAt, ...savedIdentity } = saved;
  const { verifiedAt: currentAt, ...currentIdentity } = current;
  // A read-only reconciliation may follow an ordinary inventory sync. A newer
  // observation cannot authorize a second write or change the bound identity.
  return (
    sameSnapshot(savedIdentity, currentIdentity) && Date.parse(currentAt) >= Date.parse(savedAt)
  );
}

async function requireNameserverRegistration(
  client: Prisma.TransactionClient | typeof db,
  organizationId: string,
  domainId: string,
  accountId: string,
) {
  const [domain, account] = await Promise.all([
    client.domain.findFirst({
      where: { id: domainId, organizationId, deletedAt: null, status: 'active' },
      select: { registrations: true },
    }),
    client.providerAccount.findFirst({
      where: { id: accountId, organizationId, credential: { isNot: null } },
      select: { id: true, providerId: true, status: true },
    }),
  ]);
  if (!domain || !account || !nameserverEligibleAccounts(domain.registrations, [account]).length)
    throw new AppError(
      'Sync this domain from its actual supported registrar account in this workspace before changing nameservers. Conflicting or unverified registrar records must be resolved first.',
      409,
    );
  const registration = domain.registrations.find(
    (row) =>
      row.providerAccountId === account.id && row.source === account.providerId && row.verifiedAt,
  )!;
  return {
    id: registration.id,
    registrar: registration.registrar,
    source: registration.source,
    providerAccountId: account.id,
    verifiedAt: registration.verifiedAt!.toISOString(),
  };
}

/** Cached once per workspace by the UI. It reveals no credential or portfolio
 * data and never treats a workspace role alone as permission to publish.
 */
export async function providerActionPolicy(ctx: Context) {
  try {
    requireRole(ctx, 'ADMIN');
    requireProviderActions(ctx.org);
    return await db.$transaction(async (tx) => {
      await lockWritableWorkspace(tx, ctx, 'ADMIN', true);
      requireProviderActions(
        await tx.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
      );
      return {
        accounts: await tx.providerAccount.findMany({
          where: {
            organizationId: ctx.org.id,
            providerId: { in: ['namecheap', 'spaceship'] },
            status: 'connected',
            credential: { isNot: null },
          },
          select: { id: true, label: true, providerId: true, status: true },
        }),
      };
    });
  } catch (error) {
    if (error instanceof AppError && [403, 409].includes(error.status)) return { accounts: [] };
    throw error;
  }
}
export async function previewProviderChange(ctx: Context, raw: unknown) {
  return previewChange(ctx, actionInput.parse(raw), true);
}

export async function previewProviderBatch(ctx: Context, inputs: ActionInput[]) {
  requireProviderActions(ctx.org);
  requireRole(ctx, inputs[0]?.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR');
  await throttle(`provider-batch-preview:${ctx.org.id}`, 10);
  const names = await db.domain.findMany({
    where: {
      organizationId: ctx.org.id,
      deletedAt: null,
      id: { in: inputs.map((input) => input.domainId) },
    },
    select: { id: true, name: true },
  });
  const nameById = new Map(names.map((domain) => [domain.id, domain.name]));
  const results = [];
  for (const input of inputs) {
    const name = nameById.get(input.domainId);
    if (!name) {
      results.push({ domainId: input.domainId, error: 'Domain not found in this workspace.' });
      continue;
    }
    try {
      results.push({
        domainId: input.domainId,
        name,
        preview: await previewChange(ctx, input, false),
      });
    } catch (error) {
      results.push({ domainId: input.domainId, name, error: safeProviderError(error) });
    }
  }
  return results;
}

async function previewChange(ctx: Context, input: ActionInput, limitRequest: boolean) {
  requireRole(ctx, input.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR');
  if (ctx.org.demo) throw new AppError('Live provider actions are unavailable in demo mode', 403);
  const domain = await db.domain.findFirst({
    where: { id: input.domainId, organizationId: ctx.org.id, deletedAt: null },
  });
  const account = await db.providerAccount.findFirst({
    where: { id: input.accountId, organizationId: ctx.org.id, credential: { isNot: null } },
    include: { credential: true },
  });
  if (!domain || !account?.credential)
    throw new AppError('Domain or connected account not found', 404);
  if (domain.status !== 'active')
    throw new AppError('Only active portfolio domains can use this workflow', 409);
  const provider = account.providerId as ProviderId;
  capability(provider, input.action);
  let registration: Awaited<ReturnType<typeof requireNameserverRegistration>> | undefined;
  if (input.action === 'changeNameservers') {
    requireProviderActions(ctx.org);
    registration = await requireNameserverRegistration(db, ctx.org.id, domain.id, account.id);
  }
  if (limitRequest) await throttle(`provider-preview:${ctx.org.id}:${account.id}`, 20);
  const client = actionClient(provider, decrypt<Credentials>(account.credential.ciphertext));
  let snapshot: unknown;
  if (
    provider === 'dynadot' &&
    input.action === 'removeListing' &&
    !(await db.domainRegistration.count({
      where: {
        domainId: domain.id,
        providerAccountId: account.id,
        source: 'dynadot',
        verifiedAt: { not: null },
      },
    }))
  )
    throw new AppError('Sync this domain from the connected Dynadot registrar account first.', 409);
  if (input.action === 'addListing') {
    if (
      provider === 'dynadot' &&
      !(await db.domainRegistration.count({
        where: {
          domainId: domain.id,
          providerAccountId: account.id,
          source: 'dynadot',
          verifiedAt: { not: null },
        },
      }))
    )
      throw new AppError(
        'Sync this domain from the connected Dynadot registrar account before listing it.',
        409,
      );
    validateListingPrice(provider, input.price, input.currency);
    if (new Decimal(input.price).gt('49999999'))
      throw new AppError('Listing price exceeds the supported limit');
    snapshot = await client.listing(domain.name);
    if (snapshot !== null)
      throw new AppError(
        'This domain already exists in the connected marketplace. Sync it before editing.',
        409,
      );
  } else if (input.action === 'removeListing') {
    const listing = await client.listing(domain.name, 'remove');
    if (provider === 'atom' && listing && listing.listingType !== 'standard')
      throw new AppError(
        'Atom API delisting requires a verified Standard listing. Manage other listing tiers directly in Atom.',
        409,
      );
    snapshot = listing;
    if (!snapshot)
      throw new AppError('This domain is not listed in this marketplace account.', 409);
  } else if (input.action === 'changeNameservers') {
    const current = await client.nameservers(domain.name);
    snapshot = { remote: current, registration };
    if (sameSnapshot(Array.isArray(current) ? current : current.hosts, input.nameservers))
      throw new AppError('These nameservers are already set.', 409);
  }
  const change = await db.$transaction(async (tx) => {
    await lockWritableWorkspace(
      tx,
      ctx,
      input.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR',
      true,
    );
    if (input.action === 'changeNameservers') {
      requireProviderActions(
        await tx.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
      );
      if (
        !sameSnapshot(
          registration,
          await requireNameserverRegistration(tx, ctx.org.id, domain.id, account.id),
        )
      )
        throw new AppError('The registrar account evidence changed. Sync and preview again.', 409);
    }
    const saved = await tx.providerChange.create({
      data: {
        organizationId: ctx.org.id,
        providerAccountId: account.id,
        domainId: domain.id,
        requestedBy: ctx.user.id!,
        action: input.action,
        input: json(input),
        snapshot: snapshot === null ? Prisma.JsonNull : json(snapshot),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    await audit(tx, ctx, 'provider.change_previewed', saved.id, {
      action: input.action,
      domainId: domain.id,
      provider,
    });
    return saved;
  });
  return {
    id: change.id,
    domainName: domain.name,
    provider: providers[provider].name,
    input,
    currentListing: input.action === 'removeListing' ? snapshot : undefined,
    currentNameservers:
      input.action === 'changeNameservers'
        ? Array.isArray((snapshot as z.infer<typeof nameserverSnapshot>).remote)
          ? (snapshot as z.infer<typeof nameserverSnapshot>).remote
          : ((snapshot as z.infer<typeof nameserverSnapshot>).remote as { hosts: string[] }).hosts
        : undefined,
    currentNameserverProvider:
      input.action === 'changeNameservers' &&
      !Array.isArray((snapshot as z.infer<typeof nameserverSnapshot>).remote)
        ? ((snapshot as z.infer<typeof nameserverSnapshot>).remote as { provider: string }).provider
        : undefined,
    expiresAt: change.expiresAt,
  };
}
export async function confirmProviderChange(ctx: Context, id: string) {
  const [result] = await confirmProviderChanges(ctx, [id], false);
  return result;
}

export async function confirmProviderChanges(ctx: Context, ids: string[], batch = true) {
  requireProviderActions(ctx.org);
  return db.$transaction(
    async (tx) => {
      await lockWritableWorkspace(tx, ctx, 'EDITOR', true);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
      requireProviderActions(organization);
      const results = [];
      for (const id of ids) results.push(await queueProviderChange(tx, ctx, id, batch));
      return results;
    },
    { timeout: 15000 },
  );
}

async function queueProviderChange(
  tx: Prisma.TransactionClient,
  ctx: Context,
  id: string,
  batch: boolean,
) {
  const change = await tx.providerChange.findFirst({
    where: { id, organizationId: ctx.org.id, requestedBy: ctx.user.id! },
    include: { account: { select: { providerId: true } } },
  });
  if (!change) throw new AppError('Preview not found', 404);
  if (batch && change.action === 'removeListing')
    throw new AppError('This operation is unavailable in a batch.', 409);
  const parsed = actionInput.safeParse(change.input);
  if (
    !parsed.success ||
    parsed.data.action !== change.action ||
    parsed.data.domainId !== change.domainId ||
    parsed.data.accountId !== change.providerAccountId
  )
    throw new AppError('This operation is unavailable. Create a new supported preview.', 409);
  capability(change.account.providerId as ProviderId, parsed.data.action);
  requireRole(ctx, change.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR');
  const member = await tx.organizationMember.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: ctx.org.id, userId: ctx.user.id! } },
  });
  requireRole(member, change.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR');
  if (change.status !== 'preview' || change.expiresAt < new Date())
    throw new AppError('Preview expired or already confirmed. Preview again.', 409);
  await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${change.providerAccountId} FOR UPDATE`;
  const account = await tx.providerAccount.findFirst({
    where: {
      id: change.providerAccountId,
      organizationId: ctx.org.id,
      credential: { isNot: null },
    },
    select: { id: true },
  });
  if (!account) throw new AppError('Connect the provider again before confirming.', 409);
  if (parsed.data.action === 'changeNameservers') {
    const saved = nameserverSnapshot.safeParse(change.snapshot);
    if (
      !saved.success ||
      !sameSnapshot(
        saved.data.registration,
        await requireNameserverRegistration(
          tx,
          ctx.org.id,
          change.domainId,
          change.providerAccountId,
        ),
      )
    )
      throw new AppError('The registrar account evidence changed. Sync and preview again.', 409);
  }
  const reserved = await tx.providerChange.updateMany({
    where: { id, status: 'preview' },
    data: { status: 'queued', confirmedAt: new Date() },
  });
  if (!reserved.count) throw new AppError('Already confirmed', 409);
  const job = await tx.syncJob.create({
    data: { providerAccountId: change.providerAccountId, kind: 'providerChange' },
  });
  await tx.providerChange.update({ where: { id }, data: { syncJobId: job.id } });
  await audit(tx, ctx, 'provider.change_confirmed', id, { jobId: job.id });
  return { changeId: id, jobId: job.id };
}
/** Retry verification reads only. The persisted executing state prevents another
 * mutation even when the original provider response or worker result was lost.
 */
export async function recheckNameserverChange(ctx: Context, id: string) {
  await throttle(`nameserver-recheck:${ctx.org.id}:${ctx.user.id}`, 10);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'ADMIN', true);
    requireProviderActions(await tx.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }));
    const change = await tx.providerChange.findFirst({
      where: {
        id,
        organizationId: ctx.org.id,
        requestedBy: ctx.user.id!,
        action: 'changeNameservers',
        status: 'unverified',
      },
    });
    if (!change?.syncJobId)
      throw new AppError('No nameserver change is available for a confirmation check.', 409);
    const parsed = actionInput.safeParse(change.input),
      snapshot = nameserverSnapshot.safeParse(change.snapshot);
    if (
      !parsed.success ||
      parsed.data.action !== 'changeNameservers' ||
      parsed.data.domainId !== change.domainId ||
      parsed.data.accountId !== change.providerAccountId ||
      !snapshot.success
    )
      throw new AppError('This nameserver change requires review.', 409);
    if (
      !sameRegistrarBinding(
        snapshot.data.registration,
        await requireNameserverRegistration(
          tx,
          ctx.org.id,
          change.domainId,
          change.providerAccountId,
        ),
        true,
      )
    )
      throw new AppError(
        'The registrar account evidence changed. Sync and review the provider.',
        409,
      );
    await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${change.providerAccountId} FOR UPDATE`;
    const busy = await tx.providerAccount.count({
      where: { id: change.providerAccountId, lockedUntil: { gt: new Date() } },
    });
    if (
      busy ||
      (await tx.syncJob.count({
        where: {
          providerAccountId: change.providerAccountId,
          status: { in: ['queued', 'running'] },
        },
      }))
    )
      throw new AppError('Wait for the current provider job to finish.', 409);
    await tx.providerChange.update({
      where: { id },
      data: { status: 'executing', finishedAt: null, error: null },
    });
    await tx.syncJob.update({
      where: { id: change.syncJobId },
      data: { status: 'queued', startedAt: null, finishedAt: null, error: null },
    });
    await audit(tx, ctx, 'provider.nameserver_confirmation_recheck', id);
    return { changeId: id, jobId: change.syncJobId };
  });
}
export async function runProviderChange(jobId: string) {
  const change = await db.providerChange.findUnique({
    where: { syncJobId: jobId },
    include: { organization: true, domain: true, account: { include: { credential: true } } },
  });
  if (!change || ['completed', 'failed', 'unverified'].includes(change.status)) return;
  const claimed = await db.providerAccount.updateMany({
    where: {
      id: change.providerAccountId,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    data: { lockOwner: jobId, lockedUntil: new Date(Date.now() + 600000) },
  });
  if (!claimed.count) throw new AppError('Provider account is busy', 503);
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
    const parsed = actionInput.safeParse(change.input);
    if (
      !parsed.success ||
      parsed.data.action !== change.action ||
      parsed.data.domainId !== change.domainId ||
      parsed.data.accountId !== change.providerAccountId
    )
      throw new AppError('This operation is unavailable. Create a new supported preview.', 409);
    const input = parsed.data;
    const nsSnapshot =
      input.action === 'changeNameservers'
        ? nameserverSnapshot.safeParse(change.snapshot)
        : undefined;
    if (nsSnapshot && !nsSnapshot.success)
      throw new AppError(
        'This nameserver preview has no verified registrar binding. Sync and preview again.',
        409,
      );
    const provider = change.account.providerId as ProviderId;
    const authorize = async () => {
      const [org, member, account, domain] = await Promise.all([
        db.organization.findUniqueOrThrow({ where: { id: change.organizationId } }),
        db.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: change.organizationId,
              userId: change.requestedBy,
            },
          },
        }),
        db.providerAccount.findFirst({
          where: {
            id: change.providerAccountId,
            organizationId: change.organizationId,
            lockOwner: jobId,
          },
          include: { credential: true },
        }),
        db.domain.findFirst({
          where: {
            id: change.domainId,
            organizationId: change.organizationId,
            deletedAt: null,
            status: 'active',
          },
        }),
      ]);
      requireProviderActions(org);
      if (!member) throw new AppError('Requester no longer belongs to the workspace', 403);
      requireRole(member, input.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR');
      capability(provider, input.action);
      if (!domain || !account?.credential || account.credential.updatedAt >= change.createdAt)
        throw new AppError(
          'Domain, credential, or account access changed. Create a new preview.',
          409,
        );
      if (
        nsSnapshot?.success &&
        !sameRegistrarBinding(
          nsSnapshot.data.registration,
          await requireNameserverRegistration(
            db,
            change.organizationId,
            change.domainId,
            change.providerAccountId,
          ),
          attempted,
        )
      )
        throw new AppError('The registrar account evidence changed. Sync and preview again.', 409);
    };
    await authorize();
    if (!change.account.credential) throw new AppError('Credentials unavailable', 409);
    const client = actionClient(
      provider,
      decrypt<Credentials>(change.account.credential.ciphertext),
    );
    const read = () =>
      input.action === 'changeNameservers'
        ? client.nameservers(change.domain.name)
        : client.listing(
            change.domain.name,
            input.action === 'removeListing' ? 'remove' : undefined,
          );
    const matches = (state: Awaited<ReturnType<typeof read>>) =>
      input.action === 'addListing'
        ? !!state &&
          'price' in state &&
          state.price !== null &&
          state.currency === input.currency &&
          new Decimal(state.price).eq(input.price) &&
          !['failed', 'sold', 'Transfer Complete'].includes(state.status)
        : input.action === 'removeListing'
          ? state === null
          : Array.isArray(state)
            ? sameSnapshot(state, input.nameservers)
            : !!state &&
              'hosts' in state &&
              state.provider === 'custom' &&
              sameSnapshot(state.hosts, input.nameservers);
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date(), error: null },
    });
    let state = await read();
    let failure: string | undefined;
    if (!attempted) {
      if (!sameSnapshot(state, nsSnapshot?.success ? nsSnapshot.data.remote : change.snapshot))
        throw new AppError(
          'Remote state changed since preview. Nothing was published; preview again.',
          409,
        );
      await authorize();
      // Save intent before the transactional authorization and remote write so a crash
      // cannot cause a second request after an uncertain provider response.
      await db.providerChange.update({ where: { id: change.id }, data: { status: 'executing' } });
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
              input.action === 'changeNameservers' ? 'ADMIN' : 'EDITOR',
              true,
            );
            const organization = await tx.organization.findUniqueOrThrow({
              where: { id: change.organizationId },
            });
            requireProviderActions(organization);
            capability(provider, input.action);
            await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id = ${change.providerAccountId} FOR UPDATE`;
            const account = await tx.providerAccount.findFirst({
              where: {
                id: change.providerAccountId,
                organizationId: change.organizationId,
                providerId: provider,
                lockOwner: jobId,
                lockedUntil: { gt: new Date() },
              },
              include: { credential: true },
            });
            const domain = await tx.domain.findFirst({
              where: {
                id: change.domainId,
                organizationId: change.organizationId,
                name: change.domain.name,
                deletedAt: null,
                status: 'active',
              },
            });
            if (
              !domain ||
              !account?.credential ||
              account.credential.ciphertext !== change.account.credential!.ciphertext ||
              account.credential.updatedAt >= change.createdAt
            )
              throw new AppError(
                'Domain, credentials, or execution lease changed. Create a fresh preview.',
                409,
              );
            if (
              provider === 'dynadot' &&
              input.action === 'removeListing' &&
              !(await tx.domainRegistration.count({
                where: {
                  domainId: change.domainId,
                  providerAccountId: change.providerAccountId,
                  source: 'dynadot',
                  verifiedAt: { not: null },
                },
              }))
            )
              throw new AppError(
                'The verified Dynadot registration changed. Sync and preview again.',
                409,
              );
            if (
              nsSnapshot?.success &&
              !sameSnapshot(
                nsSnapshot.data.registration,
                await requireNameserverRegistration(
                  tx,
                  change.organizationId,
                  change.domainId,
                  change.providerAccountId,
                ),
              )
            )
              throw new AppError(
                'The registrar account evidence changed. Sync and preview again.',
                409,
              );
            if (performance.now() >= sendDeadline)
              throw new AppError(
                'Provider authorization timed out before sending. Try again.',
                503,
              );
            attempted = true;
            if (input.action === 'addListing')
              await client.addListing(change.domain.name, input.price);
            else if (input.action === 'removeListing')
              await client.removeListing(
                change.domain.name,
                state && 'price' in state ? state : undefined,
              );
            else if (input.action === 'changeNameservers')
              await client.setNameservers(change.domain.name, input.nameservers);
          },
          { timeout: 90000, maxWait: 10000 },
        );
      } catch (error) {
        if (error instanceof ProviderMutationNotSentError) {
          attempted = false;
          throw error;
        }
        if (!attempted) throw error;
        failure = safeProviderError(error);
        /* Verify uncertain replies, never resend automatically. */
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          state = await read();
          if (matches(state)) break;
        } catch {
          /* Retry verification reads only. */
        }
        if (attempt < 4) await sleep(1000);
      }
    }
    if (!matches(state))
      throw new AppError(
        failure ||
          'The provider has not confirmed the requested state. Check the provider and sync before making another attempt.',
        502,
      );
    await db.$transaction(async (tx) => {
      if (input.action === 'addListing' && state && 'price' in state) {
        await tx.domainListing.upsert({
          where: { domainId_marketplace: { domainId: change.domainId, marketplace: provider } },
          create: {
            domainId: change.domainId,
            marketplace: provider,
            providerAccountId: change.providerAccountId,
            binPrice: state.price,
            currency: state.currency,
            status: state.status,
            source: provider,
            verifiedAt: new Date(),
            stale: false,
          },
          update: {
            providerAccountId: change.providerAccountId,
            binPrice: state.price,
            currency: state.currency,
            status: state.status,
            source: provider,
            verifiedAt: new Date(),
            stale: false,
          },
        });
        await tx.domainPriceHistory.create({
          data: {
            domainId: change.domainId,
            marketplace: provider,
            price: state.price,
            currency: state.currency,
            source: 'confirmed-listing-creation',
          },
        });
      } else if (input.action === 'removeListing') {
        await tx.domainListing.deleteMany({
          where: {
            domainId: change.domainId,
            marketplace: provider,
            providerAccountId: change.providerAccountId,
          },
        });
      } else if (input.action === 'changeNameservers' && nsSnapshot?.success) {
        // Only a matching provider read can reach this point. Keep that evidence
        // on the exact synced registration, rather than a local manual row.
        await lockWritableWorkspaceForActor(
          tx,
          change.organizationId,
          change.requestedBy,
          'ADMIN',
          true,
        );
        if (
          !sameRegistrarBinding(
            nsSnapshot.data.registration,
            await requireNameserverRegistration(
              tx,
              change.organizationId,
              change.domainId,
              change.providerAccountId,
            ),
            true,
          )
        )
          throw new AppError('Registrar binding changed before confirmation was recorded.', 409);
        await tx.domainRegistration.update({
          where: { id: nsSnapshot.data.registration.id },
          data: { nameservers: input.nameservers, source: provider, verifiedAt: new Date() },
        });
      }
      await tx.providerChange.update({
        where: { id: change.id },
        data: { status: 'completed', finishedAt: new Date(), error: null },
      });
      const marketplace =
        provider === 'spaceship' && input.action !== 'changeNameservers'
          ? 'SellerHub'
          : providers[provider].name;
      const awaitingReview =
        input.action === 'addListing' &&
        state &&
        'status' in state &&
        listingNeedsReview(state.status);
      await queueActivityNotice(tx, {
        eventId: change.id,
        category: 'other',
        organizationId: change.organizationId,
        recipientId: change.requestedBy,
        title:
          input.action === 'changeNameservers'
            ? 'Nameservers updated'
            : input.action === 'removeListing'
              ? 'Marketplace listing removed'
              : awaitingReview
                ? 'Marketplace listing submitted'
                : 'Marketplace listing added',
        message:
          input.action === 'changeNameservers'
            ? `${marketplace} confirmed the nameserver update for ${change.domain.name}.`
            : input.action === 'removeListing'
              ? `${change.domain.name} was delisted from ${marketplace}.`
              : awaitingReview
                ? `${marketplace} accepted ${change.domain.name} and still reports it as pending.`
                : `${marketplace} confirmed the listing for ${change.domain.name}.`,
      });
      await tx.syncJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          added: input.action === 'addListing' ? 1 : 0,
          updated: input.action !== 'addListing' ? 1 : 0,
        },
      });
      await tx.syncJobItem.upsert({
        where: { jobId_domainName: { jobId, domainName: change.domain.name } },
        create: { jobId, domainName: change.domain.name, status: 'verified' },
        update: { status: 'verified' },
      });
      await tx.auditLog.create({
        data: {
          organizationId: change.organizationId,
          actorId: change.requestedBy,
          action: 'provider.change_verified',
          entityId: change.id,
          detail: { action: input.action, jobId },
        },
      });
    });
  } catch (error) {
    const status = attempted ? 'unverified' : 'failed';
    const message = safeProviderError(error);
    await db.$transaction([
      db.providerChange.update({
        where: { id: change.id },
        data: { status, error: message, finishedAt: new Date() },
      }),
      db.syncJob.update({
        where: { id: jobId },
        data: { status, error: message, finishedAt: new Date() },
      }),
      db.integrationError.create({
        data: { jobId, code: 'PROVIDER_CHANGE_' + status.toUpperCase(), message },
      }),
      db.auditLog.create({
        data: {
          organizationId: change.organizationId,
          actorId: change.requestedBy,
          action: 'provider.change_' + status,
          entityId: change.id,
        },
      }),
    ]);
  } finally {
    clearInterval(heartbeat);
    await db.providerAccount.updateMany({
      where: { id: change.providerAccountId, lockOwner: jobId },
      data: { lockedUntil: null, lockOwner: null },
    });
  }
}
