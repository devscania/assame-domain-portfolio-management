import { db } from './db';

/** Remove only records already unusable by authentication, in bounded batches. */
export async function cleanupExpiredAuthentication() {
  return db.$transaction(async (tx) => {
    const sessions =
      await tx.$executeRaw`DELETE FROM "AccountLoginSession" WHERE id IN (SELECT id FROM "AccountLoginSession" WHERE "expiresAt" <= NOW() ORDER BY "expiresAt", id LIMIT 500 FOR UPDATE SKIP LOCKED) AND "expiresAt" <= NOW()`;
    const tokens =
      await tx.$executeRaw`DELETE FROM "AuthToken" WHERE id IN (SELECT id FROM "AuthToken" WHERE "expiresAt" <= NOW() ORDER BY "expiresAt", id LIMIT 500 FOR UPDATE SKIP LOCKED) AND "expiresAt" <= NOW()`;
    const throttles =
      await tx.$executeRaw`DELETE FROM "AuthThrottle" WHERE key IN (SELECT key FROM "AuthThrottle" WHERE "resetAt" < NOW() ORDER BY "resetAt", key LIMIT 500 FOR UPDATE SKIP LOCKED) AND "resetAt" < NOW()`;
    // Inactive request-budget rows can be discarded after their rolling window.
    await tx.$executeRaw`DELETE FROM "SpaceshipRequestBudget" WHERE key IN (SELECT key FROM "SpaceshipRequestBudget" WHERE "updatedAt" < NOW() - INTERVAL '10 minutes' ORDER BY "updatedAt", key LIMIT 500 FOR UPDATE SKIP LOCKED) AND "updatedAt" < NOW() - INTERVAL '10 minutes'`;
    // Expire observations only after both alert aggregation windows have closed.
    await tx.$executeRaw`DELETE FROM "SuspiciousActivity" WHERE id IN (SELECT id FROM "SuspiciousActivity" WHERE "raisedAt" IS NULL AND "lastSeenAt" < NOW() - INTERVAL '2 days' ORDER BY "lastSeenAt", id LIMIT 500 FOR UPDATE SKIP LOCKED) AND "raisedAt" IS NULL`;
    return { sessions, tokens, throttles };
  });
}
