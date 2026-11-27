import { db } from './db';
import { activeDomain } from './workspace-owner';
import { emailConfigured, sendRenewalReminder } from './auth-email';
import { logger } from './security';

function enabled() {
  return process.env.RENEWAL_REMINDERS_ENABLED === 'true' && emailConfigured();
}
function weekStart(now: Date) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
}
/** Queue at most one digest per owned workspace in a UTC week. */
export async function scheduleRenewalReminders(now = new Date()) {
  if (!enabled()) return 0;
  const start = weekStart(now);
  const end = new Date(now.getTime() + 30 * 86400000);
  const eligible = await db.$queryRaw<{ organizationId: string; ownerId: string }[]>`
    SELECT DISTINCT o.id AS "organizationId", u.id AS "ownerId"
    FROM "DomainRegistration" r
    JOIN "Domain" d ON d.id = r."domainId"
    JOIN "Organization" o ON o.id = d."organizationId"
    JOIN "User" u ON u.id = o."workspaceOwnerId"
    JOIN "OrganizationMember" m ON m."organizationId" = o.id AND m."userId" = u.id AND m.role = 'OWNER'
    JOIN "UserPreference" p ON p."userId" = u.id AND p."renewalEmails" = true
    WHERE r."expiresAt" > ${now} AND r."expiresAt" <= ${end}
      AND d."deletedAt" IS NULL AND d.status <> 'archived' AND o.demo = false
      AND u."emailVerified" IS NOT NULL AND u."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "OrganizationMember" m2 WHERE m2."organizationId" = o.id AND m2.role = 'OWNER' AND m2."userId" <> u.id)
      AND NOT EXISTS (SELECT 1 FROM "DomainSale" s WHERE s."domainId" = d.id AND s.status = 'completed')
      AND NOT EXISTS (SELECT 1 FROM "RenewalReminder" rr WHERE rr."organizationId" = o.id AND rr."ownerId" = u.id AND rr."weekStart" = ${start}::date)
    ORDER BY o.id, u.id LIMIT 100`;
  if (!eligible.length) return 0;
  const result = await db.renewalReminder.createMany({
    data: eligible.map((item) => ({ ...item, weekStart: start })),
    skipDuplicates: true,
  });
  return result.count;
}
/** Claim once before delivery; uncertain attempts are never automatically replayed. */
export async function sendOneRenewalReminder(now = new Date()) {
  if (!enabled()) return false;
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "RenewalReminder" SET status = 'sending' WHERE id = (
      SELECT id FROM "RenewalReminder" WHERE status = 'pending' ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id`;
  if (!claimed.length) return false;
  const id = claimed[0].id;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        const initial = await tx.renewalReminder.findUnique({ where: { id } });
        if (!initial || initial.status !== 'sending') return;
        // Transfer, workspace deletion, and account removal use the same lock order.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${initial.ownerId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${initial.organizationId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "UserPreference" WHERE "userId" = ${initial.ownerId} FOR UPDATE`;
        const [user, org] = await Promise.all([
          tx.user.findUnique({
            where: { id: initial.ownerId },
            select: {
              email: true,
              emailVerified: true,
              deletedAt: true,
              preference: { select: { renewalEmails: true } },
            },
          }),
          tx.organization.findUnique({
            where: { id: initial.organizationId },
            select: {
              demo: true,
              workspaceOwnerId: true,
              members: { where: { role: 'OWNER' }, select: { userId: true } },
            },
          }),
        ]);
        const count = await tx.domainRegistration.count({
          where: {
            expiresAt: { gt: now, lte: new Date(now.getTime() + 30 * 86400000) },
            domain: { organizationId: initial.organizationId, ...activeDomain },
          },
        });
        if (
          initial.weekStart.getTime() !== weekStart(now).getTime() ||
          !user?.emailVerified ||
          user.deletedAt ||
          !user.preference?.renewalEmails ||
          !org ||
          org.demo ||
          org.workspaceOwnerId !== initial.ownerId ||
          org.members.length !== 1 ||
          org.members[0].userId !== initial.ownerId ||
          !count
        ) {
          await tx.renewalReminder.update({ where: { id }, data: { status: 'skipped' } });
          return;
        }
        try {
          await sendRenewalReminder(user.email);
          await tx.renewalReminder.update({
            where: { id },
            data: { status: 'sent', sentAt: new Date() },
          });
        } catch {
          await tx.renewalReminder.update({ where: { id }, data: { status: 'failed' } });
          logger.error('Renewal reminder delivery failed; automatic retry is disabled');
        }
      },
      { maxWait: 5000, timeout: 60000 },
    );
  } catch {
    // The SMTP outcome may be unknown. Keep the claim for operator review.
    logger.error('Renewal reminder outcome is uncertain; automatic retry is disabled');
  }
  return true;
}
