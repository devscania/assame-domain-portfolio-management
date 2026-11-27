import type { Prisma } from '@prisma/client';
import { emailConfigured, sendActivityEmail } from './auth-email';
import { db } from './db';
import { allowsActivityEmail, type ActivityEmailCategory } from './activity-email-policy';
import { logger } from './security';

type ActivityEvent = {
  eventId: string;
  organizationId: string;
  recipientId: string;
  category: ActivityEmailCategory;
  title: string;
  message: string;
};

async function recipient(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  return tx.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      organization: { select: { workspaceOwnerId: true, demo: true } },
      user: {
        select: {
          email: true,
          emailVerified: true,
          deletedAt: true,
          preference: {
            select: {
              activityEmails: true,
              activityBulkEmails: true,
              activityPriceEmails: true,
              activitySyncEmails: true,
            },
          },
        },
      },
    },
  });
}

function eligible(member: Awaited<ReturnType<typeof recipient>>, category: ActivityEmailCategory) {
  return Boolean(
    member &&
    !member.organization.demo &&
    member.organization.workspaceOwnerId &&
    member.user.emailVerified &&
    !member.user.deletedAt &&
    member.user.preference?.activityEmails &&
    allowsActivityEmail(member.user.preference, category),
  );
}

export async function queueActivityNotice(tx: Prisma.TransactionClient, event: ActivityEvent) {
  const member = await recipient(tx, event.organizationId, event.recipientId);
  const ownerId = member?.organization.workspaceOwnerId;
  if (!ownerId || !eligible(member, event.category)) return;
  await tx.activityNotice.createMany({ data: [{ ...event, ownerId }], skipDuplicates: true });
}

export async function sendOneActivityNotice() {
  if (!emailConfigured()) return false;
  const result = await db.$transaction(async (tx) => {
    const [pending] = await tx.$queryRaw<(ActivityEvent & { ownerId: string })[]>`
      SELECT "eventId", "ownerId", "organizationId", "recipientId", title, message, category
      FROM "ActivityNotice" WHERE status='pending'
      ORDER BY "createdAt", "eventId" LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!pending) return null;
    const { eventId, ownerId, organizationId, recipientId, title, message, category } = pending;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ownerId} FOR UPDATE`;
    const member =
      organizationId && recipientId ? await recipient(tx, organizationId, recipientId) : null;
    const settleWithoutDelivery = async (status: string) => {
      await tx.activityNotice.update({
        where: { eventId },
        data: { status, title: null, message: null },
      });
      return { skipped: true } as const;
    };
    if (
      !member ||
      !eligible(member, category) ||
      member.organization.workspaceOwnerId !== ownerId ||
      !title ||
      !message
    )
      return settleWithoutDelivery('skipped');

    const now = new Date();
    await tx.activityNotice.update({
      where: { eventId },
      data: { status: 'sending', reservedAt: now },
    });
    return { skipped: false, eventId, email: member.user.email, title, message } as const;
  });
  if (!result) return false;
  if (result.skipped) return true;

  let sentAt: Date | null = null;
  try {
    await sendActivityEmail(result.email, result.title, result.message);
    sentAt = new Date();
  } catch {
    logger.error('Workspace activity email delivery failed; automatic retry is disabled');
  }
  await db.activityNotice.updateMany({
    where: { eventId: result.eventId, status: 'sending' },
    data: { status: sentAt ? 'sent' : 'failed', sentAt, title: null, message: null },
  });
  return true;
}
