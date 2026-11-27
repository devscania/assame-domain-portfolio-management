import { db } from '@/lib/db';

/** A completed dispatch pass, not proof of provider or email delivery. Uses database time. */
export async function recordWorkerDispatch() {
  await db.$executeRaw`INSERT INTO "WorkerHeartbeat" (id, "lastCompletedAt")
    VALUES ('outbox', NOW()) ON CONFLICT (id)
    DO UPDATE SET "lastCompletedAt" = EXCLUDED."lastCompletedAt"`;
}

export async function workerDispatchHealth() {
  const [row] = await db.$queryRaw<{ lastCompletedAt: Date; recent: boolean }[]>`
    SELECT "lastCompletedAt", "lastCompletedAt" >= NOW() - INTERVAL '5 minutes' AS recent
    FROM "WorkerHeartbeat" WHERE id = 'outbox'`;
  return row ?? { lastCompletedAt: null, recent: false };
}
