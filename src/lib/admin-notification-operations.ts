import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { isPlatformAdmin, platformAdminActor } from './platform-admin';
import { AppError } from './security';
import { throttle } from './throttle';

export const noticeKinds = ['renewal', 'welcome'] as const;
export type NoticeKind = (typeof noticeKinds)[number];
const cases = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
export const reviewInput = z
  .object({
    kind: z.enum(noticeKinds),
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    expectedStatus: z.enum(['sending', 'failed']),
    outcome: z.enum(['delivered', 'not_delivered', 'unresolved']),
    caseReference: cases,
    confirm: z.literal(true),
  })
  .strict();
export const retryInput = z
  .object({
    kind: z.enum(noticeKinds),
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    reviewId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    confirmNonDelivery: z.literal(true),
  })
  .strict();

/** One audited retry only, after a specific latest review found non-delivery. */
export async function retryReviewedNotification(raw: unknown) {
  const actorId = await platformAdminActor();
  const input = retryInput.parse(raw);
  if (input.kind === 'welcome') throw new AppError('Welcome email retries are unavailable.', 409);
  await throttle(`platform-notification-retry:${actorId}`, 30);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { emailVerified: true, deletedAt: true },
      });
      if (!actor?.emailVerified || actor.deletedAt || !isPlatformAdmin(actorId))
        throw new AppError('Not found', 404);
      const locked = await tx.$queryRaw<
        { status: string }[]
      >`SELECT status FROM "RenewalReminder" WHERE id = ${input.id} FOR UPDATE`;
      if (locked.length !== 1 || locked[0].status !== 'failed')
        throw new AppError('Only a completed failed attempt may be reviewed for retry.', 409);
      const latest = await tx.platformAdminAudit.findFirst({
        where: { action: `notification.${input.kind}.reviewed`, resourceId: input.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const evidence = z
        .object({
          observedStatus: z.literal('failed'),
          outcome: z.literal('not_delivered'),
          caseReference: cases,
        })
        .safeParse(latest?.detail);
      if (!latest || latest.id !== input.reviewId || !evidence.success)
        throw new AppError('A current review confirming non-delivery is required.', 409);
      if (
        await tx.platformAdminAudit.count({
          where: { action: `notification.${input.kind}.retry_queued`, resourceId: input.id },
        })
      )
        throw new AppError('The permitted retry has already been used.', 409);
      await tx.renewalReminder.update({ where: { id: input.id }, data: { status: 'pending' } });
      await tx.platformAdminAudit.create({
        data: {
          actorId,
          action: `notification.${input.kind}.retry_queued`,
          resourceId: input.id,
          detail: { reviewId: latest.id, caseReference: evidence.data.caseReference },
        },
      });
      return { queued: true };
    },
    { timeout: 15000 },
  );
}

/** A review records an operator's evidence, not a change to actual delivery state. */
export async function reviewNotification(raw: unknown) {
  const actorId = await platformAdminActor();
  const input = reviewInput.parse(raw);
  await throttle(`platform-notification-review:${actorId}`, 60);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { emailVerified: true, deletedAt: true },
    });
    if (!actor?.emailVerified || actor.deletedAt || !isPlatformAdmin(actorId))
      throw new AppError('Not found', 404);
    const locked =
      input.kind === 'renewal'
        ? await tx.$queryRaw<
            { status: string }[]
          >`SELECT status FROM "RenewalReminder" WHERE id = ${input.id} FOR UPDATE`
        : await tx.$queryRaw<
            { status: string }[]
          >`SELECT status FROM "WelcomeNotice" WHERE "ownerId" = ${input.id} FOR UPDATE`;
    if (locked.length !== 1 || locked[0].status !== input.expectedStatus)
      throw new AppError('The delivery status changed. Refresh and review again.', 409);
    await tx.platformAdminAudit.create({
      data: {
        actorId,
        action: `notification.${input.kind}.reviewed`,
        resourceId: input.id,
        detail: {
          observedStatus: input.expectedStatus,
          outcome: input.outcome,
          caseReference: input.caseReference,
        },
      },
    });
    return { recorded: true };
  });
}

export async function notificationOperations(page: number, status: 'failed' | 'sending') {
  const actorId = await platformAdminActor();
  await db.platformAdminAudit.create({ data: { actorId, action: 'notifications.view' } });
  const args = {
    where: { status },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    skip: (page - 1) * 25,
    take: 26,
  };
  const [renewal, welcomeRows, security] = await Promise.all([
    db.renewalReminder.findMany({
      ...args,
      select: { id: true, ownerId: true, status: true, createdAt: true },
    }),
    db.welcomeNotice.findMany({
      where: { status },
      orderBy: [{ createdAt: 'desc' }, { ownerId: 'desc' }],
      skip: (page - 1) * 25,
      take: 26,
      select: { ownerId: true, status: true, createdAt: true },
    }),
    db.securityNotice.findMany({
      ...args,
      where: { status: status === 'sending' ? { in: ['sending', 'unverified'] } : 'failed' },
      select: { id: true, ownerId: true, status: true, createdAt: true },
    }),
  ]);
  const welcome = welcomeRows.map((row) => ({ ...row, id: row.ownerId }));
  const items = [
    ...renewal.map((row) => ({ ...row, queue: 'renewal' as const, kind: 'renewal' })),
    ...welcome.map((row) => ({ ...row, queue: 'welcome' as const, kind: 'welcome' })),
  ];
  const audits = items.length
    ? await db.$queryRaw<
        {
          id: string;
          resourceId: string;
          action: string;
          detail: Prisma.JsonValue;
          createdAt: Date;
        }[]
      >`
    SELECT DISTINCT ON ("resourceId", action) id, "resourceId", action, detail, "createdAt"
    FROM "PlatformAdminAudit"
    WHERE action IN (${Prisma.join(noticeKinds.flatMap((kind) => [`notification.${kind}.reviewed`, `notification.${kind}.retry_queued`]))})
      AND "resourceId" IN (${Prisma.join(items.map((item) => item.id))})
    ORDER BY "resourceId", action, "createdAt" DESC, id DESC
  `
    : [];
  return { renewal, welcome, security, audits };
}
