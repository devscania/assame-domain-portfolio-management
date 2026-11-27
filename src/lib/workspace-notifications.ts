import { db } from './db';
import { AppError } from './security';

/** Suppression never changes the workspace's stored notifications. */
export async function workspaceNotifications(organizationId: string, userId: string) {
  const [member, preference] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, joinedAt: true },
    }),
    db.userPreference.findUnique({ where: { userId }, select: { notifications: true } }),
  ]);
  if (!member) throw new AppError('Workspace access changed. Refresh and try again.', 403);
  if (preference?.notifications === false) return [];
  return db.notification.findMany({
    where: {
      organizationId,
      organization: { members: { some: { id: member.id, userId } } },
      readAt: null,
      createdAt: { gte: member.joinedAt },
      reads: { none: { membershipId: member.id } },
    },
    select: { id: true, title: true },
    take: 10,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Acknowledges only explicitly displayed notifications for the current membership. */
export async function markWorkspaceNotificationsRead(
  organizationId: string,
  userId: string,
  ids: string[],
) {
  if (!ids.length) return;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const member = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, joinedAt: true },
    });
    if (!member) throw new AppError('Workspace access changed. Refresh and try again.', 403);
    const preference = await tx.userPreference.findUnique({
      where: { userId },
      select: { notifications: true },
    });
    if (preference?.notifications === false)
      throw new AppError('In-app notifications are disabled.', 409);
    const notifications = await tx.notification.findMany({
      where: { organizationId, id: { in: ids }, readAt: null, createdAt: { gte: member.joinedAt } },
      select: { id: true },
      take: 10,
    });
    await tx.notificationRead.createMany({
      data: notifications.map((notice) => ({ notificationId: notice.id, membershipId: member.id })),
      skipDuplicates: true,
    });
  });
}
