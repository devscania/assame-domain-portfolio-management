import { createHash } from 'node:crypto';
import { db } from './db';
import { AppError } from './security';

/** Spaceship documents five domain-info reads and five nameserver writes per domain per 300s.
 * Use a 301s rolling window shared across workspaces and API keys. External callers cannot be
 * observed, and Spaceship can still impose a stricter limit or reject a request.
 */
export async function reserveSpaceshipDomainRequest(domain: string, kind: 'read' | 'write', verification = false) {
  const key = createHash('sha256').update(`spaceship:${kind}:${domain.toLowerCase()}`).digest('hex');
  // Lock before obtaining database time: an UPSERT can otherwise wait on a row
  // while its precomputed timestamp ages, shortening the effective window.
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "SpaceshipRequestBudget" ("key", "stamps", "updatedAt") VALUES (${key}, ARRAY[]::bigint[], NOW()) ON CONFLICT ("key") DO NOTHING`;
    await tx.$queryRaw`SELECT "key" FROM "SpaceshipRequestBudget" WHERE "key" = ${key} FOR UPDATE`;
    return tx.$queryRaw<{ key: string }[]>`
    WITH request_clock AS (SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms)
    UPDATE "SpaceshipRequestBudget" SET
      "stamps" = array_append(
        ARRAY(SELECT stamp FROM unnest("SpaceshipRequestBudget"."stamps") AS stamp
              WHERE stamp > (SELECT ms FROM request_clock) - 301000),
        (SELECT ms FROM request_clock) + ${verification ? 60000 : 0}),
      "updatedAt" = NOW()
    WHERE "key" = ${key} AND cardinality(ARRAY(
      SELECT stamp FROM unnest("SpaceshipRequestBudget"."stamps") AS stamp
      WHERE stamp > (SELECT ms FROM request_clock) - 301000
    )) < 5
    RETURNING "key"`;
  }, { timeout: 5000, maxWait: 5000 });
  if (!rows.length)
    throw new AppError('Spaceship limits domain requests. Wait at least five minutes, then retry.', 429);
}
