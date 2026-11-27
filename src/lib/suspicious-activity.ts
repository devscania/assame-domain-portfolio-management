import { randomUUID } from 'node:crypto';
import { db } from './db';
import { logger } from './security';

const signals = {
  password_failures: { threshold: 5, windowSeconds: 15 * 60 },
} as const;

export type SuspiciousActivityKind = keyof typeof signals;

/** Aggregate only typed signals and internal account IDs. */
export async function recordSuspiciousActivity(
  kind: SuspiciousActivityKind,
  accountId: string | null,
) {
  const { threshold, windowSeconds } = signals[kind];
  const subjectId = accountId && /^[A-Za-z0-9_-]{1,128}$/.test(accountId) ? accountId : null;
  try {
    await db.$executeRaw`
      WITH observation AS (
        SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS seen
      )
      INSERT INTO "SuspiciousActivity" (
        id, kind, "subjectId", "windowStart", count, "firstSeenAt", "lastSeenAt"
      )
      SELECT ${randomUUID()}, ${kind}, ${subjectId}::text,
        date_bin(make_interval(secs => ${windowSeconds}::double precision), seen, TIMESTAMP '1970-01-01'),
        1, seen, seen
      FROM observation
      WHERE ${subjectId}::text IS NOT NULL
      ON CONFLICT (kind, "subjectId", "windowStart") DO UPDATE SET
        count = "SuspiciousActivity".count + 1,
        "lastSeenAt" = GREATEST("SuspiciousActivity"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "raisedAt" = COALESCE("SuspiciousActivity"."raisedAt",
          CASE WHEN "SuspiciousActivity".count + 1 >= ${threshold} THEN EXCLUDED."lastSeenAt" END)
    `;
  } catch {
    // A monitoring failure should not change sign-in outcomes.
    logger.warn({ kind }, 'Suspicious activity could not be recorded');
  }
}
