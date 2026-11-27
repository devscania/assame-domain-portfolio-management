import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import type { Context } from '../src/lib/access';

const fixture = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('../src/lib/access', async () => ({
  context: async () => fixture.context,
  requireRole: (await import('../src/lib/permissions')).requireRole,
}));
import { POST } from '../src/app/api/console/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('bulk snapshots and recovery authorization', () => {
  let ownerId = '',
    memberId = '',
    orgId = '';
  let domainIds: string[] = [];
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
    vi.stubEnv('AUTH_SECRET', 'bulk-authorization-test-secret');
    const owner = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
      },
    });
    const member = await db.user.create({ data: { email: `${randomUUID()}@example.test` } });
    ownerId = owner.id;
    memberId = member.id;
    const org = await db.organization.create({
      data: {
        name: 'Bulk authorization',
        workspaceOwnerId: ownerId,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: memberId, role: 'EDITOR' },
          ],
        },
      },
    });
    orgId = org.id;
    const role = await db.workspaceCustomRole.create({
      data: {
        organizationId: orgId,
        name: 'Recovery editor',
        baseRole: 'EDITOR',
        allowDomainDeletion: true,
      },
    });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: memberId } },
      data: { customRoleId: role.id },
    });
    fixture.context = {
      user: { id: ownerId },
      org,
      role: 'OWNER',
      members: [],
    } as unknown as Context;
  });
  beforeEach(async () => {
    domainIds = [];
    for (let i = 0; i < 2; i++) {
      const name = `${randomUUID()}.test`;
      domainIds.push(
        (
          await db.domain.create({
            data: {
              organizationId: orgId,
              name,
              unicodeName: name,
              tld: 'test',
              registrations: {
                create: [
                  { registrar: 'First', nameservers: ['ns1.example.test'], renewalCost: '10' },
                  { registrar: 'Second', nameservers: ['ns2.example.test'], renewalCost: '20' },
                ],
              },
            },
          })
        ).id,
      );
    }
  });
  afterEach(async () => {
    await db.domain.deleteMany({ where: { organizationId: orgId } });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it.each([
    ['renewalCost', '35'],
    ['registrar', 'Replacement'],
    ['nameservers', 'ns3.example.test'],
  ])(
    'rejects stale %s previews for changes to any registration and permits a fresh confirmation',
    async (field, value) => {
      const preview = await call('bulk.preview', { ids: domainIds, field, value });
      expect(preview.status).toBe(200);
      const { token } = await preview.json();
      // Only a secondary registration changes; Domain.updatedAt stays untouched.
      await db.domainRegistration.update({
        where: { domainId_registrar: { domainId: domainIds[1], registrar: 'Second' } },
        data: { renewalCost: '21' },
      });
      expect((await call('bulk.confirm', { token })).status).toBe(409);
      expect(await db.domainRegistration.count({ where: { domainId: domainIds[0] } })).toBe(2);
      expect(
        (
          await db.domainRegistration.findUniqueOrThrow({
            where: { domainId_registrar: { domainId: domainIds[0], registrar: 'First' } },
          })
        ).renewalCost?.toString(),
      ).toBe('10');
      const fresh = await call('bulk.preview', { ids: domainIds, field, value });
      expect((await call('bulk.confirm', { token: (await fresh.json()).token })).status).toBe(200);
    },
  );
  it.each(['renewalCost', 'registrar', 'nameservers'])(
    'rejects deleted domains in %s confirmations atomically',
    async (field) => {
      const value =
        field === 'renewalCost' ? '35' : field === 'registrar' ? 'Replacement' : 'ns3.example.test';
      const preview = await call('bulk.preview', { ids: domainIds, field, value });
      const { token } = await preview.json();
      await db.domain.update({ where: { id: domainIds[1] }, data: { deletedAt: new Date() } });
      expect((await call('bulk.confirm', { token })).status).toBe(409);
      expect(
        (
          await db.domainRegistration.findUniqueOrThrow({
            where: { domainId_registrar: { domainId: domainIds[0], registrar: 'First' } },
          })
        ).renewalCost?.toString(),
      ).toBe('10');
    },
  );
});
