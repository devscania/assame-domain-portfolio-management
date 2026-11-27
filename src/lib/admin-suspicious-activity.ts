import { z } from 'zod';
import { db } from './db';
import { isPlatformAdmin, platformAdminActor, requirePlatformAdmin } from './platform-admin';
import { AppError } from './security';
import { throttle } from './throttle';

export type AlertFilter = 'open' | 'unread' | 'dismissed';

export async function unreadSuspiciousActivity() {
  await platformAdminActor();
  return db.suspiciousActivity.count({
    where: { raisedAt: { not: null }, dismissedAt: null, readAt: null },
  });
}

export async function listSuspiciousActivity(page: number, filter: AlertFilter) {
  const actorId = await requirePlatformAdmin();
  await db.platformAdminAudit.create({ data: { actorId, action: 'alerts.view' } });
  return db.suspiciousActivity.findMany({
    where: {
      raisedAt: { not: null },
      dismissedAt: filter === 'dismissed' ? { not: null } : null,
      ...(filter === 'unread' ? { readAt: null } : {}),
    },
    orderBy: [{ raisedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * 25,
    take: 26,
    select: {
      id: true,
      kind: true,
      subjectId: true,
      count: true,
      firstSeenAt: true,
      lastSeenAt: true,
      readAt: true,
      dismissedAt: true,
    },
  });
}

const updateInput = z
  .object({
    id: z.uuid(),
    action: z.enum(['read', 'dismiss']),
  })
  .strict();

export async function updateSuspiciousActivity(raw: unknown) {
  const actorId = await platformAdminActor();
  const input = updateInput.parse(raw);
  await throttle(`platform-alerts:${actorId}`, 60);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { deletedAt: true, emailVerified: true },
    });
    if (!actor?.emailVerified || actor.deletedAt || !isPlatformAdmin(actorId))
      throw new AppError('Not found', 404);
    const now = new Date();
    const changed = await tx.suspiciousActivity.updateMany({
      where: {
        id: input.id,
        raisedAt: { not: null },
        dismissedAt: null,
        ...(input.action === 'read' ? { readAt: null } : {}),
      },
      data: input.action === 'read' ? { readAt: now } : { dismissedAt: now },
    });
    if (changed.count) {
      await tx.platformAdminAudit.create({
        data: {
          actorId,
          action: input.action === 'read' ? 'alert.read' : 'alert.dismissed',
          resourceId: input.id,
        },
      });
    } else if (
      !(await tx.suspiciousActivity.findFirst({
        where: { id: input.id, raisedAt: { not: null } },
        select: { id: true },
      }))
    ) {
      throw new AppError('Alert not found', 404);
    }
    return { ok: true };
  });
}
