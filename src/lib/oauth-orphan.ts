import type { Prisma } from '@prisma/client';

/** Caller holds the user lock. Only an untouched, never-linked OAuth signup qualifies. */
export async function isPristineOAuthOrphan(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      emailVerified: { not: null },
      passwordHash: null,
      oauthSignupPending: { is: { recovered: false } },
      accounts: { none: {} },
      sessions: { none: {} },
      loginSessions: { none: {} },
      preference: { is: null },
      transfersSent: { none: {} },
      transfersReceived: { none: {} },
      renewalReminders: { none: {} },
      securityNotices: { none: {} },
      welcomeNotice: { is: null },
    },
    select: {
      _count: { select: { members: true, ownedWorkspaces: true } },
      ownedWorkspaces: {
        select: {
          workspaceOwnerId: true,
          demo: true,
          pricePublishingEnabled: true,
          providerActionsEnabled: true,
          members: { select: { userId: true, role: true } },
          _count: {
            select: {
              domains: true,
              accounts: true,
              customRoles: true,
              tags: true,
              audits: true,
              notifications: true,
              transfers: true,
              providerChanges: true,
              priceChanges: true,
              renewalReminders: true,
            },
          },
        },
      },
    },
  });
  if (!user || user._count.members !== 1 || user._count.ownedWorkspaces !== 1) return false;
  const workspace = user.ownedWorkspaces[0];
  return (
    workspace.workspaceOwnerId === userId &&
    !workspace.demo &&
    !workspace.pricePublishingEnabled &&
    !workspace.providerActionsEnabled &&
    workspace.members.length === 1 &&
    workspace.members[0].userId === userId &&
    workspace.members[0].role === 'OWNER' &&
    Object.values(workspace._count).every((count) => count === 0)
  );
}
