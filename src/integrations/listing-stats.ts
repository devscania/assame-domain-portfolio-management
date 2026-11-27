import { lockWorkspaceOwner } from '@/lib/workspace-owner';
import { z } from 'zod';
import { db } from '@/lib/db';
import { lockWritableWorkspace, lockWorkspaceMembershipForActor } from '@/lib/workspace-write';
import { decrypt, AppError, safeProviderError } from '@/lib/security';
import { requireRole } from '@/lib/permissions';
import { audit } from '@/lib/portfolio';
import type { Context } from '@/lib/access';
import type { Credentials } from './adapters';
import { afternicNormalize } from './adapters';
import { ProviderHttp } from './http';

export async function readListingStats(provider: string, credentials: Credentials, name: string) {
  if (provider === 'atom') {
    const q = new URLSearchParams({
      api_token: credentials.apiKey,
      user_id: credentials.userId!,
      domain_name: name,
    });
    const raw = await new ProviderHttp('https://www.atom.com/api/marketplace', {}, 1500).get(
      '/domain-analytics?' + q,
    );
    const result = z
      .object({
        success: z.literal(true).optional(),
        total_views: z.number().int().nonnegative(),
        total_shortlists: z.number().int().nonnegative(),
        total_offers: z.number().int().nonnegative(),
      })
      .parse(raw);
    return {
      views: result.total_views,
      shortlists: result.total_shortlists,
      offers: result.total_offers,
      period: 'Provider totals; period not supplied',
      observedAt: new Date().toISOString(),
    };
  }
  if (provider === 'afternic') {
    const raw = await new ProviderHttp(
      'https://api.afternic.com',
      { Authorization: `sso-key ${credentials.apiKey}:${credentials.apiSecret}` },
      500,
    ).get('/v3/aftermarket/customers/my/domains/' + encodeURIComponent(name));
    const result = afternicNormalize(raw).analytics;
    if (result?.views === undefined && result?.leads === undefined)
      throw new AppError('Afternic did not return view or lead statistics for this listing.', 502);
    return {
      ...result,
      period: 'Provider listing counters; period not supplied',
      observedAt: new Date().toISOString(),
    };
  }
  throw new AppError(
    'Listing traffic statistics are not exposed by this provider’s integrated API.',
    409,
  );
}
export async function queueListingStats(ctx: Context, domainIds: string[]) {
  requireRole(ctx);
  if (ctx.org.demo)
    throw new AppError('Demo statistics cannot be refreshed from live providers', 409);
  if (!domainIds.length || domainIds.length > 500)
    throw new AppError('Select between 1 and 500 domains');
  const domains = await db.domain.count({
    where: { id: { in: domainIds }, organizationId: ctx.org.id, deletedAt: null },
  });
  if (domains !== new Set(domainIds).size)
    throw new AppError('Selection contains unavailable domains', 403);
  const listings = await db.domainListing.findMany({
    where: {
      domainId: { in: domainIds },
      domain: { organizationId: ctx.org.id, deletedAt: null },
      marketplace: { in: ['afternic', 'atom'] },
      account: { organizationId: ctx.org.id, credential: { isNot: null } },
    },
    include: { domain: { select: { name: true } } },
  });
  if (!listings.length)
    throw new AppError(
      'No connected Afternic or Atom listings in this selection. Spaceship and Dynadot marketplace traffic is unavailable through the integrated APIs.',
      409,
    );
  const accounts = [...new Set(listings.map((l) => l.providerAccountId!))];
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
    const jobs = [];
    for (const accountId of accounts.sort()) {
      await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${accountId} FOR UPDATE`;
      if (
        await tx.syncJob.count({
          where: { providerAccountId: accountId, status: { in: ['queued', 'running'] } },
        })
      )
        throw new AppError(
          'Wait for current provider jobs to finish, then request statistics.',
          409,
        );
      const job = await tx.syncJob.create({
        data: {
          providerAccountId: accountId,
          requestedBy: ctx.user.id!,
          kind: 'statistics',
          items: {
            create: listings
              .filter((l) => l.providerAccountId === accountId)
              .map((l) => ({ domainName: l.domain.name, status: 'pending' })),
          },
        },
      });

      jobs.push(job.id);
    }
    await audit(tx, ctx, 'listing.statistics_queued', undefined, { domainCount: domains, jobs });
    return { jobs };
  });
}
export async function runListingStats(jobId: string) {
  const job = await db.syncJob.findUnique({
    where: { id: jobId },
    include: { account: { include: { credential: true, organization: true } }, items: true },
  });
  if (!job || !['queued', 'running'].includes(job.status)) return;
  if (job.kind !== 'statistics') throw new AppError('Incorrect statistics job', 409);
  try {
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
  const claim = await db.providerAccount.updateMany({
    where: {
      id: job.providerAccountId,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    data: { lockOwner: jobId, lockedUntil: new Date(Date.now() + 600000) },
  });
  if (!claim.count) throw new AppError('Provider account is busy', 503);
  const heartbeat = setInterval(() => {
    void db.providerAccount
      .updateMany({
        where: { id: job.providerAccountId, lockOwner: jobId },
        data: { lockedUntil: new Date(Date.now() + 600000) },
      })
      .catch(() => undefined);
  }, 30000);
  let updated = 0,
    failed = 0;
  try {
    if (!job.account.credential || job.account.organization.demo)
      throw new AppError('Live provider credentials unavailable', 409);
    const credential = decrypt<Credentials>(job.account.credential.ciphertext);
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date() },
    });
    for (const item of job.items) {
      try {
        const current = await db.providerAccount.findFirst({
          where: { id: job.providerAccountId, lockOwner: jobId, credential: { isNot: null } },
          include: { credential: true },
        });
        if (
          !current?.credential ||
          current.credential.updatedAt.getTime() !== job.account.credential.updatedAt.getTime()
        )
          throw new AppError('Connection changed or lease expired', 409);
        const listing = await db.domainListing.findFirst({
          where: {
            providerAccountId: job.providerAccountId,
            domain: {
              name: item.domainName,
              organizationId: job.account.organizationId,
              deletedAt: null,
            },
          },
        });
        if (!listing) throw new AppError('Listing is no longer available', 404);
        const result = await readListingStats(job.account.providerId, credential, item.domainName);
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
              id: job.providerAccountId,
              lockOwner: jobId,
              credential: { ciphertext: job.account.credential!.ciphertext },
            },
          });
          if (!lease) throw new AppError('Connection changed or lease expired', 409);
          await tx.domainListing.update({ where: { id: listing.id }, data: { analytics: result } });
          await tx.syncJobItem.update({ where: { id: item.id }, data: { status: 'verified' } });
        });
        updated++;
      } catch (error) {
        failed++;
        await db.syncJobItem.update({ where: { id: item.id }, data: { status: 'failed' } });
        await db.integrationError.create({
          data: { jobId, code: 'STATISTICS_UNAVAILABLE', message: safeProviderError(error) },
        });
      }
      // Pacing is shared across per-domain clients as well as their retries.
      await db.syncJob.update({ where: { id: jobId }, data: { updated } });
      if (item !== job.items[job.items.length - 1])
        await new Promise((r) => setTimeout(r, job.account.providerId === 'atom' ? 1500 : 500));
    }
    const status = failed ? (updated ? 'partial' : 'failed') : 'completed';
    await db.syncJob.update({
      where: { id: jobId },
      data: {
        status,
        updated,
        error: failed
          ? `${failed} listing statistics requests failed; previous counters were preserved.`
          : null,
        finishedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: job.account.organizationId,
        actorId: 'worker',
        action: 'listing.statistics_' + status,
        entityId: jobId,
        detail: { updated, failed },
      },
    });
  } catch (error) {
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: 'failed', error: safeProviderError(error), finishedAt: new Date() },
    });
  } finally {
    clearInterval(heartbeat);
    await db.providerAccount.updateMany({
      where: { id: job.providerAccountId, lockOwner: jobId },
      data: { lockedUntil: null, lockOwner: null },
    });
  }
}
