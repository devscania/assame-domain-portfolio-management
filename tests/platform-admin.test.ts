import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const state = vi.hoisted(() => ({ userId: '' }));
vi.mock('../src/auth', () => ({
  auth: async () => (state.userId ? { user: { id: state.userId } } : null),
}));
import {
  adminAccount,
  adminAccounts,
  adminAudit,
  adminContacts,
  adminOverview,
  adminPageNumber,
  isPlatformAdmin,
} from '../src/lib/platform-admin';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('platform administration boundary', () => {
  const marker = randomUUID();
  const email = `admin-fixture-${marker}@example.test`;
  let adminId = '',
    ownerId = '',
    orgId = '';
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('A dedicated test database is required');
    const admin = await db.user.create({
      data: { email, passwordHash: 'PRIVATE_PASSWORD_HASH', emailVerified: new Date() },
    });
    adminId = admin.id;
    const owner = await db.user.create({
      data: {
        email: `owner-${marker}@example.test`,
        name: `Portfolio Owner ${marker}`,
        emailVerified: new Date(),
      },
    });
    ownerId = owner.id;
    const org = await db.organization.create({
      data: {
        name: 'Admin fixture',
        workspaceOwnerId: ownerId,
        members: { create: { userId: ownerId, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: `admin-${marker}.test`,
        unicodeName: `admin-${marker}.test`,
        tld: 'test',
      },
    });
    await db.contactRequest.create({
      data: { name: 'Synthetic contact', email, message: 'A fixture question.', kind: 'contact' },
    });
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', adminId);
  });
  afterAll(async () => {
    await db.platformAdminAudit.deleteMany({ where: { actorId: adminId } });
    await db.contactRequest.deleteMany({ where: { email } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ownerId] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('denies anonymous and workspace-owner access before reading data', async () => {
    state.userId = '';
    await expect(adminOverview()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK');
    state.userId = ownerId;
    for (const action of [
      () => adminOverview(),
      () => adminAccounts(1),
      () => adminAccount(ownerId),
      () => adminContacts(1),
      () => adminAudit(1),
    ])
      await expect(action()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK');
    expect(await db.platformAdminAudit.count({ where: { actorId: ownerId } })).toBe(0);
    await db.user.update({ where: { id: ownerId }, data: { emailVerified: null } });
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', ownerId);
    await expect(adminOverview()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK');
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', adminId);
  });
  it('audits audit-log access and only reveals approved operational details', async () => {
    state.userId = adminId;
    const action = 'notification.renewal.reviewed';
    const resourceId = `audit-${marker}`;
    await db.platformAdminAudit.create({
      data: {
        actorId: adminId,
        action,
        resourceId,
        detail: {
          outcome: 'unresolved',
          caseReference: 'CASE-1',
          secret: 'PRIVATE_PROVIDER_SECRET',
        },
      },
    });
    const changes = await adminAudit(1, 'changes');
    const row = changes.find((item) => item.resourceId === resourceId);
    expect(row?.detail).toEqual({ outcome: 'unresolved', caseReference: 'CASE-1' });
    expect(JSON.stringify(changes)).not.toContain('PRIVATE_PROVIDER_SECRET');
    expect(changes.some((item) => item.action.endsWith('.view'))).toBe(false);
    expect(
      await db.platformAdminAudit.count({ where: { actorId: adminId, action: 'audit.view' } }),
    ).toBeGreaterThan(0);
  });
  it('keeps account and contact queries scoped and omits credential fields', async () => {
    state.userId = adminId;
    expect(isPlatformAdmin(adminId)).toBe(true);
    expect((await adminOverview()).accounts).toBeGreaterThanOrEqual(2);
    expect((await adminAccounts(1, ownerId)).map((account) => account.id)).toEqual([ownerId]);
    expect(await adminAccounts(1, 'unlikely%search')).toEqual([]);
    expect((await adminAccount(ownerId))._count.ownedWorkspaces).toBe(1);
    expect(JSON.stringify(await adminAccount(adminId))).not.toContain('PRIVATE_PASSWORD_HASH');
    expect(
      (await adminContacts(1, undefined, 'contact')).some((item) => item.email === email),
    ).toBe(true);
    expect((await adminContacts(1, undefined, 'bug')).some((item) => item.email === email)).toBe(
      false,
    );
  });
  it('bounds administrative pagination', () => {
    expect(adminPageNumber(undefined)).toBe(1);
    expect(adminPageNumber('9999')).toBe(1000);
  });
});
