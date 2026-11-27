import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { cleanupExpiredAuthentication } from '../src/lib/auth-expiration-cleanup';

describe.skipIf(!process.env.TEST_DATABASE_URL)('expired authentication cleanup', () => {
  let userId = '';
  const suffix = randomUUID();
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 3_600_000);
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    userId = (await db.user.create({ data: { email: `${suffix}@example.test` } })).id;
    await db.accountLoginSession.createMany({
      data: [
        {
          id: `${suffix}-expired`,
          userId,
          sessionVersion: 0,
          method: 'credentials',
          expiresAt: past,
        },
        {
          id: `${suffix}-active`,
          userId,
          sessionVersion: 0,
          method: 'credentials',
          expiresAt: future,
        },
      ],
    });
    await db.authToken.createMany({
      data: [
        { userId, kind: 'verify', tokenHash: `${suffix}-expired`, expiresAt: past },
        { userId, kind: 'verify', tokenHash: `${suffix}-active`, expiresAt: future },
      ],
    });
    await db.authThrottle.createMany({
      data: [
        { key: `${suffix}-expired`, resetAt: past },
        { key: `${suffix}-active`, resetAt: future },
      ],
    });
  });
  afterAll(async () => {
    await db.authThrottle.deleteMany({ where: { key: { startsWith: suffix } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });
  it('removes expired sessions, tokens and rate limits while preserving active records', async () => {
    await cleanupExpiredAuthentication();
    expect(
      await db.accountLoginSession.findUnique({ where: { id: `${suffix}-expired` } }),
    ).toBeNull();
    expect(
      await db.accountLoginSession.findUnique({ where: { id: `${suffix}-active` } }),
    ).not.toBeNull();
    expect(await db.authToken.findUnique({ where: { tokenHash: `${suffix}-expired` } })).toBeNull();
    expect(
      await db.authToken.findUnique({ where: { tokenHash: `${suffix}-active` } }),
    ).not.toBeNull();
    expect(await db.authThrottle.findUnique({ where: { key: `${suffix}-expired` } })).toBeNull();
    expect(await db.authThrottle.findUnique({ where: { key: `${suffix}-active` } })).not.toBeNull();
  });
});
