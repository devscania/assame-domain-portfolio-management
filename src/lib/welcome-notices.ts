import type { Prisma } from '@prisma/client';
import { db } from './db';
import { emailConfigured, sendWelcomeEmail } from './auth-email';
import { logger } from './security';

/** Called in the transaction that first verifies or creates an OAuth account. */
export async function queueWelcomeNotice(tx: Prisma.TransactionClient, ownerId: string) {
  if (process.env.WELCOME_EMAILS_ENABLED !== 'true') return;
  await tx.welcomeNotice.createMany({ data: [{ ownerId }], skipDuplicates: true });
}

/** Claim once; an interrupted or failed SMTP send is never automatically retried. */
export async function sendOneWelcomeNotice() {
  if (process.env.WELCOME_EMAILS_ENABLED !== 'true' || !emailConfigured()) return false;
  const claimed = await db.$queryRaw<{ ownerId: string }[]>`
    UPDATE "WelcomeNotice" SET status = 'sending' WHERE "ownerId" = (
      SELECT "ownerId" FROM "WelcomeNotice" WHERE status = 'pending'
      ORDER BY "createdAt", "ownerId" FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING "ownerId"`;
  if (!claimed.length) return false;
  const ownerId = claimed[0].ownerId;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
        const [user, notice] = await Promise.all([
          tx.user.findUnique({
            where: { id: ownerId },
            select: { email: true, emailVerified: true, deletedAt: true },
          }),
          tx.welcomeNotice.findUnique({ where: { ownerId } }),
        ]);
        if (!notice || notice.status !== 'sending') return;
        if (!user?.emailVerified || user.deletedAt) {
          await tx.welcomeNotice.update({ where: { ownerId }, data: { status: 'skipped' } });
          return;
        }
        try {
          await sendWelcomeEmail(user.email);
          await tx.welcomeNotice.update({
            where: { ownerId },
            data: { status: 'sent', sentAt: new Date() },
          });
        } catch {
          await tx.welcomeNotice.update({ where: { ownerId }, data: { status: 'failed' } });
          logger.error('Welcome email delivery failed; automatic retry is disabled');
        }
      },
      { maxWait: 5000, timeout: 60000 },
    );
  } catch {
    logger.error('Welcome email outcome is uncertain; automatic retry is disabled');
  }
  return true;
}
