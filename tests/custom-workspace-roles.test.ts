import { lockWritableWorkspaceForActor } from '../src/lib/workspace-write';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { queueSync, runSync } from '../src/integrations/sync';
import { requestWorkspaceTransfer, resolveWorkspaceTransfer } from '../src/lib/workspace-transfers';
import { deleteAccount } from '../src/lib/account-security';
import { hash } from 'argon2';
import type { Context } from '../src/lib/access';

const fixture = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('../src/lib/access', async () => ({
  context: async () => fixture.context,
  requireRole: (await import('../src/lib/permissions')).requireRole,
}));
import { POST } from '../src/app/api/console/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Custom workspace roles', () => {
  let ownerId = '',
    memberId = '',
    orgId = '',
    roleId = '',
    accountId = '';
  let ownerCtx: Context, memberCtx: Context;
  const origin = 'http://localhost:3010';
  const call = (action: string, data: object) =>
    POST(
      new Request(`${origin}/api/console`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ action, data }),
      }),
    );
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('AUTH_SECRET', 'custom-role-tests-only');
    const owner = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
      },
    });
    const member = await db.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    ownerId = owner.id;
    memberId = member.id;
    const org = await db.organization.create({
      data: {
        name: 'Custom roles',
        workspaceOwnerId: ownerId,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: memberId, role: 'VIEWER' },
          ],
        },
      },
    });
    orgId = org.id;
    ownerCtx = {
      user: { id: ownerId, email: owner.email },
      org,
      role: 'OWNER',
      members: [],
    } as unknown as Context;
    memberCtx = {
      user: { id: memberId, email: member.email },
      org,
      role: 'EDITOR',
      members: [],
    } as unknown as Context;
    fixture.context = ownerCtx;
    await db.provider.upsert({
      where: { id: 'namecheap' },
      create: { id: 'namecheap', name: 'Namecheap', kind: 'registrar' },
      update: {},
    });
    accountId = (
      await db.providerAccount.create({
        data: {
          organizationId: orgId,
          providerId: 'namecheap',
          label: randomUUID(),
          status: 'connected',
          credential: { create: { ciphertext: 'test-only' } },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db.$disconnect();
  });
  it('lets only the owner create and assign a named workspace role', async () => {
    fixture.context = memberCtx;
    expect(
      (
        await call('team.customRole.create', {
          name: 'Portfolio editors',
          baseRole: 'EDITOR',
          allowProviderWrites: false,
        })
      ).status,
    ).toBe(403);
    fixture.context = ownerCtx;
    expect(
      (
        await call('team.customRole.create', {
          name: 'Portfolio editors',
          baseRole: 'EDITOR',
          allowProviderWrites: false,
        })
      ).status,
    ).toBe(200);
    roleId = (await db.workspaceCustomRole.findFirstOrThrow({ where: { organizationId: orgId } }))
      .id;
    expect(
      (await call('team.save', { email: memberCtx.user.email!, role: `custom:${roleId}` })).status,
    ).toBe(200);
    const otherOrg = await db.organization.create({
      data: {
        name: 'Other',
        workspaceOwnerId: memberId,
        members: { create: { userId: memberId, role: 'OWNER' } },
      },
    });
    const foreignRole = await db.workspaceCustomRole.create({
      data: { organizationId: otherOrg.id, name: 'Foreign', baseRole: 'ADMIN' },
    });
    expect(
      (await call('team.save', { email: memberCtx.user.email!, role: `custom:${foreignRole.id}` }))
        .status,
    ).toBe(403);
    await db.organization.delete({ where: { id: otherOrg.id } });
    const member = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgId, userId: memberId } },
    });
    expect(member).toMatchObject({ role: 'EDITOR', customRoleId: roleId });
    await expect(
      db.$transaction((tx) => lockWritableWorkspaceForActor(tx, orgId, memberId)),
    ).resolves.toBeUndefined();
    await expect(
      db.$transaction((tx) => lockWritableWorkspaceForActor(tx, orgId, memberId, 'EDITOR', true)),
    ).rejects.toThrow('provider publishing');
  });
  it('edits an assigned role atomically and rejects unauthorized or stale edits', async () => {
    const expected = {
      name: 'Portfolio editors',
      allowProviderWrites: false,
      allowDomainDeletion: true,
      allowFinanceRecords: true,
      allowSync: true,
    };
    const next = { ...expected, allowProviderWrites: true, allowDomainDeletion: false };
    fixture.context = memberCtx;
    expect((await call('team.customRole.update', { id: roleId, expected, next })).status).toBe(403);
    fixture.context = ownerCtx;
    expect((await call('team.customRole.update', { id: roleId, expected, next })).status).toBe(200);
    await expect(
      db.$transaction((tx) => lockWritableWorkspaceForActor(tx, orgId, memberId, 'EDITOR', true)),
    ).resolves.toBeUndefined();
    await expect(
      db.$transaction((tx) =>
        lockWritableWorkspaceForActor(tx, orgId, memberId, 'EDITOR', false, 'domainDeletion'),
      ),
    ).rejects.toThrow('does not allow');
    expect((await call('team.customRole.update', { id: roleId, expected, next })).status).toBe(409);
    expect(
      await db.auditLog.count({
        where: { organizationId: orgId, action: 'team.custom_role_updated' },
      }),
    ).toBe(1);
    expect(
      (await call('team.customRole.update', { id: roleId, expected: next, next: expected })).status,
    ).toBe(200);
  });
  it('enforces restricted actions and rechecks synchronization permission for queued jobs', async () => {
    fixture.context = ownerCtx;
    const queued = await queueSync(memberCtx, accountId);
    expect(
      (
        await call('team.customRole.create', {
          name: 'Restricted editor',
          baseRole: 'ADMIN',
          allowProviderWrites: false,
          allowDomainDeletion: false,
          allowFinanceRecords: false,
          allowSync: false,
        })
      ).status,
    ).toBe(200);
    const restricted = await db.workspaceCustomRole.findFirstOrThrow({
      where: { organizationId: orgId, name: 'Restricted editor' },
    });
    expect(
      (await call('team.save', { email: memberCtx.user.email!, role: `custom:${restricted.id}` }))
        .status,
    ).toBe(200);
    const domain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'restricted.test',
        unicodeName: 'restricted.test',
        tld: 'test',
      },
    });
    const restrictedCtx = { ...memberCtx, role: 'ADMIN' } as Context;
    fixture.context = restrictedCtx;
    expect((await call('domain.delete', { id: domain.id })).status).toBe(403);
    expect((await call('bulk.delete', { ids: [domain.id] })).status).toBe(403);
    expect(
      (await call('expense.create', { domainId: domain.id, amount: '10', category: 'renewal' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('sale.create', {
          domainId: domain.id,
          marketplace: 'Example',
          grossAmount: '200',
          currency: 'USD',
          soldAt: '2026-11-10',
        })
      ).status,
    ).toBe(403);
    expect((await call('sync.schedule', { accountId, hours: 24 })).status).toBe(403);
    expect((await call('sync.schedule', { accountId, hours: 0 })).status).toBe(200);
    await expect(queueSync(restrictedCtx, accountId)).rejects.toThrow('does not allow');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(runSync(queued.id)).rejects.toThrow('does not allow');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe(
      'failed',
    );
    expect((await db.domain.findUniqueOrThrow({ where: { id: domain.id } })).deletedAt).toBeNull();
    fixture.context = ownerCtx;
    expect(
      (await call('team.save', { email: memberCtx.user.email!, role: `custom:${roleId}` })).status,
    ).toBe(200);
    expect((await call('team.customRole.delete', { id: restricted.id })).status).toBe(200);
  });
  it('prevents assigned role deletion while a member uses it', async () => {
    fixture.context = ownerCtx;
    expect((await call('team.customRole.delete', { id: roleId })).status).toBe(409);
    await expect(db.workspaceCustomRole.delete({ where: { id: roleId } })).rejects.toThrow();
  });
  it('removes a departing account that holds a custom role without deleting the shared workspace', async () => {
    const password = 'custom-role-test-password';
    const departing = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        passwordHash: await hash(password),
      },
    });
    await db.organizationMember.create({
      data: { organizationId: orgId, userId: departing.id, role: 'EDITOR', customRoleId: roleId },
    });
    await deleteAccount(departing.id, password);
    expect(await db.user.findUnique({ where: { id: departing.id } })).toBeNull();
    expect(await db.workspaceCustomRole.findUnique({ where: { id: roleId } })).not.toBeNull();
  });
  it('clears the recipient custom role on ownership transfer', async () => {
    const transfer = await requestWorkspaceTransfer(
      ownerId,
      orgId,
      memberCtx.user.email!,
      'Custom roles',
    );
    await resolveWorkspaceTransfer(memberId, transfer.id, 'accept');
    expect(
      await db.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgId, userId: memberId } },
      }),
    ).toMatchObject({ role: 'OWNER', customRoleId: null });
  });
  it('allows a workspace containing assigned custom roles to be deleted atomically', async () => {
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: ownerId } },
      data: { role: 'EDITOR', customRoleId: roleId },
    });
    await db.organization.delete({ where: { id: orgId } });
    expect(await db.workspaceCustomRole.count({ where: { id: roleId } })).toBe(0);
  });
});
