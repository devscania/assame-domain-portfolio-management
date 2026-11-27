import { createHash } from 'node:crypto';
import { db } from './db';
import { AppError } from './security';
export async function throttle(identity: string, limit = 15, windowSeconds = 900) {
  const key = createHash('sha256').update(identity).digest('hex');
  const rows = await db.$queryRaw<
    { attempts: number }[]
  >`INSERT INTO "AuthThrottle" ("key", "attempts", "resetAt") VALUES (${key},1,NOW() + ${windowSeconds} * interval '1 second') ON CONFLICT ("key") DO UPDATE SET "attempts" = CASE WHEN "AuthThrottle"."resetAt" < NOW() THEN 1 ELSE "AuthThrottle"."attempts" + 1 END, "resetAt" = CASE WHEN "AuthThrottle"."resetAt" < NOW() THEN NOW() + ${windowSeconds} * interval '1 second' ELSE "AuthThrottle"."resetAt" END RETURNING "attempts"`;
  if (rows[0].attempts > limit)
    throw new AppError(
      windowSeconds === 900
        ? 'Too many attempts. Try again in 15 minutes.'
        : 'Provider request budget reached. Retry after the rate-limit window resets.',
      429,
    );
}
