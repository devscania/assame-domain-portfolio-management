import { randomUUID } from 'node:crypto';
import { actionClient } from '@/integrations/actions';
import type { Credentials } from '@/integrations/adapters';
import { queueActivityNotice } from './activity-notices';
import { db } from './db';
import { decrypt } from './security';

export async function refreshPendingAfternicListings(now = new Date()) {
  const listings = await db.domainListing.findMany({
    where: {
      marketplace: 'afternic',
      source: 'afternic',
      status: 'PENDING',
      verifiedAt: { lt: new Date(now.getTime() - 120000) },
      OR: [
        { statusCheckedAt: null },
        { statusCheckedAt: { lt: new Date(now.getTime() - 600000) } },
      ],
      domain: { deletedAt: null, status: 'active', organization: { demo: false } },
      account: {
        providerId: 'afternic',
        status: { not: 'disconnected' },
        credential: { isNot: null },
      },
    },
    orderBy: [
      { statusCheckedAt: { sort: 'asc', nulls: 'first' } },
      { verifiedAt: 'asc' },
      { id: 'asc' },
    ],
    take: 5,
    include: {
      domain: { select: { name: true, organizationId: true } },
      account: { include: { credential: true } },
    },
  });
  for (const listing of listings) {
    const account = listing.account;
    const credential = account?.credential;
    if (!account || !credential || account.organizationId !== listing.domain.organizationId)
      continue;
    const lease = randomUUID();
    const claimed = await db.providerAccount.updateMany({
      where: {
        id: account.id,
        status: { not: 'disconnected' },
        credential: { updatedAt: credential.updatedAt },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
      },
      data: { lockOwner: lease, lockedUntil: new Date(Date.now() + 60000) },
    });
    if (!claimed.count) continue;
    const snapshot = {
      id: listing.id,
      status: 'PENDING',
      verifiedAt: listing.verifiedAt,
      providerAccountId: account.id,
      statusCheckedAt: listing.statusCheckedAt,
      domain: {
        organizationId: account.organizationId,
        name: listing.domain.name,
        deletedAt: null,
        status: 'active',
      },
      account: { lockOwner: lease, credential: { updatedAt: credential.updatedAt } },
    };
    const checkedAt = new Date();
    try {
      const started = await db.domainListing.updateMany({
        where: snapshot,
        data: { statusCheckedAt: checkedAt },
      });
      if (!started.count) continue;
      const remote = await actionClient(
        'afternic',
        decrypt<Credentials>(credential.ciphertext),
      ).listing(listing.domain.name);
      if (!remote) continue;
      await db.$transaction(async (tx) => {
        const changed = await tx.domainListing.updateMany({
          where: { ...snapshot, statusCheckedAt: checkedAt },
          data: { status: remote.status, verifiedAt: new Date() },
        });
        if (!changed.count || remote.status !== 'ACTIVE') return;
        const change = await tx.providerChange.findFirst({
          where: {
            organizationId: account.organizationId,
            domainId: listing.domainId,
            providerAccountId: account.id,
            action: 'addListing',
            status: 'completed',
          },
          orderBy: { finishedAt: 'desc' },
          select: { id: true, requestedBy: true },
        });
        if (change)
          await queueActivityNotice(tx, {
            eventId: `listing-active:${change.id}`,
            category: 'other',
            organizationId: account.organizationId,
            recipientId: change.requestedBy,
            title: 'Afternic listing active',
            message: `Afternic now reports ${listing.domain.name} as active.`,
          });
      });
    } catch {
      // The pending status stays in place until a provider read succeeds.
    } finally {
      await db.providerAccount.updateMany({
        where: { id: account.id, lockOwner: lease },
        data: { lockOwner: null, lockedUntil: null },
      });
    }
  }
}
