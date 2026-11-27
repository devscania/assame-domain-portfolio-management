import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { workspaceOverview } from '../src/lib/workspace-overview';

describe.skipIf(!process.env.TEST_DATABASE_URL)('account workspace overview', () => {
  const suffix = randomUUID();
  let owner = '',
    member = '',
    outsider = '',
    owned = '',
    second = '',
    shared = '',
    provider = '';
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    const users = await Promise.all(
      ['owner', 'member', 'outsider'].map((prefix) =>
        db.user.create({
          data: {
            email: `${prefix}-${suffix}@example.test`,
            name: prefix,
          },
        }),
      ),
    );
    [owner, member, outsider] = users.map((user) => user.id);
    const create = async (name: string, workspaceOwnerId: string, extraMember?: string) =>
      db.organization.create({
        data: {
          name,
          workspaceOwnerId,
          members: {
            create: [
              { userId: workspaceOwnerId, role: 'OWNER' },
              ...(extraMember ? [{ userId: extraMember, role: 'VIEWER' as const }] : []),
            ],
          },
        },
      });
    owned = (await create('Owned portfolio', owner, member)).id;
    second = (await create('Second portfolio', owner)).id;
    shared = (await create('Shared portfolio', member, owner)).id;
    const domain = async (
      organizationId: string,
      name: string,
      status = 'active',
      deletedAt: Date | null = null,
    ) =>
      db.domain.create({
        data: {
          organizationId,
          name: `${name}-${suffix}.test`,
          unicodeName: `${name}-${suffix}.test`,
          tld: 'test',
          status,
          deletedAt,
        },
      });
    await domain(owned, 'active');
    await domain(owned, 'archived', 'archived');
    await domain(owned, 'deleted', 'active', new Date());
    const sold = await domain(owned, 'sold');
    await db.domainSale.create({
      data: {
        domainId: sold.id,
        marketplace: 'fixture',
        grossAmount: 10,
        currency: 'USD',
        status: 'completed',
      },
    });
    await domain(second, 'second');
    await domain(shared, 'shared');
    provider = `fixture-${suffix}`;
    await db.provider.create({
      data: { id: provider, name: `Provider ${suffix}`, kind: 'registrar' },
    });
    await db.providerAccount.create({
      data: {
        organizationId: owned,
        providerId: provider,
        label: 'fixture',
        status: 'connected',
        lastSyncAt: new Date('2026-01-01T10:00:00Z'),
      },
    });
    await db.providerAccount.create({
      data: { organizationId: shared, providerId: provider, label: 'private', status: 'connected' },
    });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [owned, second, shared] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, member, outsider] } } });
    await db.provider.deleteMany({ where: { id: provider } });
    await db.$disconnect();
  });
  it('shows details only for owned portfolios', async () => {
    const overview = await workspaceOverview(owner);
    expect(overview.memberships.map((item) => item.organization.id).sort()).toEqual(
      [owned, second, shared].sort(),
    );
    expect(overview.owned).toHaveLength(2);
    expect(overview.owned.find((item) => item.id === owned)).toMatchObject({
      domains: 1,
      memberCount: 2,
      integrationCount: 1,
      integrations: [`Provider ${suffix}`],
      lastSyncAt: new Date('2026-01-01T10:00:00Z'),
    });
    expect(overview.owned.find((item) => item.id === shared)).toBeUndefined();
    expect(
      overview.owned.find((item) => item.id === owned)?.members.map((item) => item.user.email),
    ).toContain(`member-${suffix}@example.test`);
  });
  it("does not disclose another account's workspace details", async () => {
    const sharedView = await workspaceOverview(member);
    expect(sharedView.owned.map((item) => item.id)).toEqual([shared]);
    expect(sharedView.memberships.some((item) => item.organization.id === owned)).toBe(true);
    const unrelated = await workspaceOverview(outsider);
    expect(unrelated.memberships).toEqual([]);
    expect(unrelated.owned).toEqual([]);
  });
  it('continues to display membership when legacy ownership needs reconciliation', async () => {
    await db.organization.update({ where: { id: second }, data: { workspaceOwnerId: null } });
    try {
      const overview = await workspaceOverview(owner);
      expect(overview.memberships).toHaveLength(3);
    } finally {
      await db.organization.update({ where: { id: second }, data: { workspaceOwnerId: owner } });
    }
  });
  it('does not show owner-only details when an owner membership is absent', async () => {
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: owned, userId: owner } },
      data: { role: 'VIEWER' },
    });
    try {
      const overview = await workspaceOverview(owner);
      expect(overview.memberships.some((item) => item.organization.id === owned)).toBe(true);
      expect(overview.owned.some((item) => item.id === owned)).toBe(false);
    } finally {
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: owned, userId: owner } },
        data: { role: 'OWNER' },
      });
    }
  });
});
