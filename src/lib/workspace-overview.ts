import { db } from './db';
import { activeDomain } from './workspace-owner';

/** Account-level overview, scoped to the authenticated user by the caller. */
export async function workspaceOverview(userId: string) {
  const [memberships, owned] = await Promise.all([
    db.organizationMember.findMany({
      where: { userId },
      select: {
        role: true,
        organization: { select: { id: true, name: true, workspaceOwnerId: true } },
      },
      orderBy: { organization: { name: 'asc' } },
    }),
    db.organization.findMany({
      where: { workspaceOwnerId: userId, members: { some: { userId, role: 'OWNER' } } },
      select: {
        id: true,
        _count: {
          select: {
            domains: { where: activeDomain },
            members: true,
            accounts: { where: { status: 'connected' } },
          },
        },
        members: {
          select: { role: true, user: { select: { name: true, email: true } } },
          orderBy: { user: { email: 'asc' } },
          take: 10,
        },
        accounts: {
          where: { status: 'connected' },
          select: { provider: { select: { name: true } } },
          orderBy: { provider: { name: 'asc' } },
          take: 20,
        },
      },
    }),
  ]);
  const ids = owned.map((org) => org.id);
  const latest = ids.length
    ? await db.providerAccount.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: ids },
          organization: { workspaceOwnerId: userId, members: { some: { userId, role: 'OWNER' } } },
        },
        _max: { lastSyncAt: true },
      })
    : [];
  return {
    memberships,
    owned: owned.map((org) => ({
      id: org.id,
      domains: org._count.domains,
      memberCount: org._count.members,
      members: org.members,
      integrationCount: org._count.accounts,
      integrations: [...new Set(org.accounts.map((account) => account.provider.name))],
      lastSyncAt: latest.find((item) => item.organizationId === org.id)?._max.lastSyncAt ?? null,
    })),
  };
}
