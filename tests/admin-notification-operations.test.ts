import { sendOneRenewalReminder } from '../src/lib/renewal-reminders';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('../src/auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
}));
import { POST } from '../src/app/api/admin/notifications/route';
import { POST as retry } from '../src/app/api/admin/notifications/retry/route';
import { notificationOperations } from '../src/lib/admin-notification-operations';

describe.skipIf(!process.env.TEST_DATABASE_URL)('notification delivery review', () => {
  let adminId = '',
    ownerId = '',
    orgId = '',
    renewalId = '';
  const origin = 'http://localhost:3010';
  const call = (body: object, requestOrigin = origin) =>
    POST(
      new Request(`${origin}/api/admin/notifications`, {
        method: 'POST',
        headers: { origin: requestOrigin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const body = (kind: string, id: string, expectedStatus = 'failed') => ({
    kind,
    id,
    expectedStatus,
    outcome: 'unresolved',
    caseReference: 'CASE-120',
    confirm: true,
  });
  const requestRetry = (kind: string, id: string, reviewId: string, requestOrigin = origin) =>
    retry(
      new Request(`${origin}/api/admin/notifications/retry`, {
        method: 'POST',
        headers: { origin: requestOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, reviewId, confirmNonDelivery: true }),
      }),
    );
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    const [admin, owner] = await Promise.all(
      ['admin', 'owner'].map((name) =>
        db.user.create({
          data: { email: `${name}-${randomUUID()}@example.test`, emailVerified: new Date() },
        }),
      ),
    );
    adminId = admin.id;
    ownerId = owner.id;
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', adminId);
    session.userId = adminId;
    const org = await db.organization.create({
      data: {
        name: 'Fixture',
        workspaceOwnerId: ownerId,
        members: { create: { userId: ownerId, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    renewalId = (
      await db.renewalReminder.create({
        data: {
          ownerId,
          organizationId: orgId,
          weekStart: new Date('2026-11-09'),
          status: 'failed',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.platformAdminAudit.deleteMany({ where: { actorId: adminId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ownerId] } } });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db.$disconnect();
  });
  it('rejects cross-origin, non-admin and stale requests without changing delivery state', async () => {
    expect((await call(body('renewal', renewalId), 'https://other.test')).status).toBe(403);
    session.userId = ownerId;
    expect((await call(body('renewal', renewalId))).status).toBe(404);
    session.userId = adminId;
    expect((await call(body('renewal', renewalId, 'sending'))).status).toBe(409);
    expect((await db.renewalReminder.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe(
      'failed',
    );
    expect(await db.platformAdminAudit.count({ where: { actorId: adminId } })).toBe(0);
  });
  it('shows notification queues and records a review without changing status or sending mail', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await db.welcomeNotice.create({ data: { ownerId, status: 'failed' } });
    const failed = await notificationOperations(1, 'failed');
    expect(failed.renewal.some((item) => item.id === renewalId)).toBe(true);
    expect(failed.welcome.some((item) => item.id === ownerId)).toBe(true);
    for (const [kind, id, state] of [
      ['renewal', renewalId, 'failed'],
      ['welcome', ownerId, 'failed'],
    ])
      expect((await call(body(kind, id, state))).status).toBe(200);
    expect((await db.renewalReminder.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe(
      'failed',
    );
    expect(
      await db.platformAdminAudit.count({
        where: { actorId: adminId, action: { endsWith: '.reviewed' } },
      }),
    ).toBe(2);
    expect((await requestRetry('welcome', ownerId, 'no-review')).status).toBe(409);
    expect(
      (await notificationOperations(1, 'failed')).audits.find(
        (entry) => entry.resourceId === renewalId,
      )?.detail,
    ).toMatchObject({ outcome: 'unresolved', caseReference: 'CASE-120' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('permits one audited retry only with current evidence of non-delivery', async () => {
    const earlier = await db.platformAdminAudit.findFirstOrThrow({
      where: { action: 'notification.renewal.reviewed', resourceId: renewalId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((await requestRetry('renewal', renewalId, earlier.id)).status).toBe(409);
    expect((await call({ ...body('renewal', renewalId), outcome: 'not_delivered' })).status).toBe(
      200,
    );
    const review = await db.platformAdminAudit.findFirstOrThrow({
      where: { action: 'notification.renewal.reviewed', resourceId: renewalId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((await requestRetry('renewal', renewalId, review.id, 'https://other.test')).status).toBe(
      403,
    );
    session.userId = ownerId;
    expect((await requestRetry('renewal', renewalId, review.id)).status).toBe(404);
    session.userId = adminId;
    const results = await Promise.all([
      requestRetry('renewal', renewalId, review.id),
      requestRetry('renewal', renewalId, review.id),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect((await db.renewalReminder.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe(
      'pending',
    );
    await db.renewalReminder.update({ where: { id: renewalId }, data: { status: 'failed' } });
    expect((await requestRetry('renewal', renewalId, review.id)).status).toBe(409);
    expect(
      await db.platformAdminAudit.count({
        where: { resourceId: renewalId, action: 'notification.renewal.retry_queued' },
      }),
    ).toBe(1);
  });
  it('rechecks current opt-in before a reviewed retry is delivered', async () => {
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const notice = await db.renewalReminder.create({
      data: { ownerId, organizationId: orgId, weekStart: monday, status: 'failed' },
    });
    expect((await call({ ...body('renewal', notice.id), outcome: 'not_delivered' })).status).toBe(
      200,
    );
    const review = await db.platformAdminAudit.findFirstOrThrow({
      where: { action: 'notification.renewal.reviewed', resourceId: notice.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((await requestRetry('renewal', notice.id, review.id)).status).toBe(200);
    vi.stubEnv('RENEWAL_REMINDERS_ENABLED', 'true');
    vi.stubEnv('SMTP_HOST', 'smtp.invalid');
    vi.stubEnv('SMTP_FROM', 'fixture@example.test');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASSWORD', '');
    await sendOneRenewalReminder(now);
    expect((await db.renewalReminder.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe(
      'skipped',
    );
  });
});
