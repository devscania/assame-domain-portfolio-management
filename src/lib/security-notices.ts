import type { Prisma } from '@prisma/client';
import { db } from './db';
import { emailConfigured, sendPasswordChangedNotice } from './auth-email';
import { logger } from './security';

/** Persist with the password update; delivery happens separately from the user's request. */
export async function queuePasswordChangedNotice(tx: Prisma.TransactionClient, ownerId: string) {
  await tx.securityNotice.create({ data: { ownerId, kind: 'password_changed' } });
}

/** Claim once. Ambiguous delivery and crashes never cause automatic resending. */
export async function sendOneSecurityNotice() {
  if (!emailConfigured()) return false;
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "SecurityNotice" SET status = 'sending' WHERE id = (
      SELECT id FROM "SecurityNotice" WHERE status = 'pending'
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id`;
  if (!claimed.length) return false;
  const id = claimed[0].id;
  try {
    await db.$transaction(
      async (tx) => {
        const notice = await tx.securityNotice.findUnique({ where: { id } });
        if (!notice || notice.status !== 'sending') return;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${notice.ownerId} FOR UPDATE`;
        const user = await tx.user.findUnique({
          where: { id: notice.ownerId },
          select: { email: true, deletedAt: true },
        });
        if (!user || user.deletedAt || notice.kind !== 'password_changed') {
          await tx.securityNotice.update({ where: { id }, data: { status: 'skipped' } });
          return;
        }
        try {
          await sendPasswordChangedNotice(user);
          await tx.securityNotice.update({
            where: { id },
            data: { status: 'sent', sentAt: new Date() },
          });
        } catch {
          // A server can accept a message before the SMTP connection fails.
          await tx.securityNotice.update({ where: { id }, data: { status: 'unverified' } });
          logger.error('Security notice outcome is uncertain; automatic retry is disabled');
        }
      },
      { maxWait: 5000, timeout: 60000 },
    );
  } catch {
    logger.error('Security notice outcome is uncertain; automatic retry is disabled');
  }
  return true;
}
