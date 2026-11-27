import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { cleanupExpiredAuthentication } from '../src/lib/auth-expiration-cleanup';
import { recordSuspiciousActivity } from '../src/lib/suspicious-activity';

const fixture = vi.hoisted(() => ({ actorId: '' }));
vi.mock('../src/auth', () => ({
  auth: async () => (fixture.actorId ? { user: { id: fixture.actorId } } : null),
}));
import { GET, PATCH } from '../src/app/api/admin/alerts/route';
import { listSuspiciousActivity } from '../src/lib/admin-suspicious-activity';

describe.skipIf(!process.env.TEST_DATABASE_URL)('platform suspicious activity alerts', () => {
  const origin = 'http://localhost:3010';
  let adminId = '',
    subjectId = '',
    alertId = '';
  const call = (action: string, requestOrigin = origin, id = alertId) =>
    PATCH(
      new Request(`${origin}/api/admin/alerts`, {
        method: 'PATCH',
        headers: { origin: requestOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      }),
    );

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    const [admin, subject] = await Promise.all(
      ['admin', 'subject'].map((role) =>
        db.user.create({
          data: { email: `alerts-${role}-${randomUUID()}@example.test`, emailVerified: new Date() },
        }),
      ),
    );
    adminId = admin.id;
    subjectId = subject.id;
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', adminId);
  });

  afterEach(async () => {
    fixture.actorId = '';
    await db.suspiciousActivity.deleteMany({ where: { subjectId } });
    await db.platformAdminAudit.deleteMany({ where: { actorId: adminId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [adminId, subjectId] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it('raises one alert at threshold and atomically counts concurrent observations', async () => {
    for (let attempt = 0; attempt < 4; attempt++)
      await recordSuspiciousActivity('password_failures', subjectId);
    const before = await db.suspiciousActivity.findFirstOrThrow({ where: { subjectId } });
    expect(before).toMatchObject({ count: 4, raisedAt: null });
    await Promise.all(
      Array.from({ length: 3 }, () => recordSuspiciousActivity('password_failures', subjectId)),
    );
    await recordSuspiciousActivity('password_failures', null);
    const submittedEmail = `${randomUUID()}@example.test`;
    await recordSuspiciousActivity('password_failures', submittedEmail);
    expect(await db.suspiciousActivity.findMany({ where: { subjectId: submittedEmail } })).toEqual(
      [],
    );
    const rows = await db.suspiciousActivity.findMany({ where: { subjectId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, count: 7, raisedAt: expect.any(Date) });
  });

  it('limits review to platform admins, keeps status changes idempotent, and retains the audit', async () => {
    await db.suspiciousActivity.deleteMany({ where: { subjectId } });
    for (let attempt = 0; attempt < 5; attempt++)
      await recordSuspiciousActivity('password_failures', subjectId);
    const alert = await db.suspiciousActivity.findFirstOrThrow({ where: { subjectId } });
    alertId = alert.id;
    fixture.actorId = subjectId;
    expect((await call('read')).status).toBe(404);
    expect((await GET()).status).toBe(404);
    fixture.actorId = adminId;
    const initialCount = await (await GET()).json();
    expect((await call('read', 'https://foreign.example')).status).toBe(403);
    expect((await call('read', origin, randomUUID())).status).toBe(404);
    expect((await listSuspiciousActivity(1, 'unread')).some(({ id }) => id === alertId)).toBe(true);
    expect((await call('read')).status).toBe(200);
    expect((await call('read')).status).toBe(200);
    const updatedCount = await (await GET()).json();
    expect(updatedCount.unread).toBe(initialCount.unread - 1);
    expect((await listSuspiciousActivity(1, 'unread')).some(({ id }) => id === alertId)).toBe(
      false,
    );
    expect((await call('dismiss')).status).toBe(200);
    await recordSuspiciousActivity('password_failures', subjectId);
    expect((await listSuspiciousActivity(1, 'open')).some(({ id }) => id === alertId)).toBe(false);
    const dismissed = await listSuspiciousActivity(1, 'dismissed');
    expect(dismissed.find(({ id }) => id === alertId)).toMatchObject({
      count: 6,
      readAt: expect.any(Date),
      dismissedAt: expect.any(Date),
    });
    expect(
      await db.platformAdminAudit.findMany({
        where: { actorId: adminId, resourceId: alertId },
        orderBy: { action: 'asc' },
        select: { action: true },
      }),
    ).toEqual([{ action: 'alert.dismissed' }, { action: 'alert.read' }]);
  });

  it('expires old subthreshold observations while retaining reviewed alerts', async () => {
    const stale = new Date(Date.now() - 3 * 86400000);
    const [partial, raised] = await Promise.all([
      db.suspiciousActivity.create({
        data: {
          id: randomUUID(),
          kind: 'password_failures',
          subjectId,
          windowStart: stale,
          lastSeenAt: stale,
          count: 2,
        },
      }),
      db.suspiciousActivity.create({
        data: {
          id: randomUUID(),
          kind: 'password_failures',
          subjectId,
          windowStart: new Date(+stale - 60_000),
          lastSeenAt: stale,
          count: 5,
          raisedAt: stale,
          dismissedAt: stale,
        },
      }),
    ]);
    await cleanupExpiredAuthentication();
    expect(await db.suspiciousActivity.findUnique({ where: { id: partial.id } })).toBeNull();
    expect(await db.suspiciousActivity.findUnique({ where: { id: raised.id } })).not.toBeNull();
  });
});
