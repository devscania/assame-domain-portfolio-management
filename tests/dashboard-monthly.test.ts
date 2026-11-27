import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { dashboard } from '../src/lib/dashboard';
import type { Context } from '../src/lib/access';

describe.skipIf(!process.env.TEST_DATABASE_URL)('workspace dashboard monthly summaries', () => {
  let orgId = '',
    otherId = '',
    ownerId = '';
  let ctx: Context;
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    const owner = await db.user.create({
      data: { email: `dashboard-${randomUUID()}@example.test` },
    });
    ownerId = owner.id;
    const org = await db.organization.create({
      data: {
        name: `dashboard-${randomUUID()}`,
        currency: 'USD',
        workspaceOwnerId: ownerId,
        members: { create: { userId: ownerId, role: 'OWNER' } },
      },
    });
    const other = await db.organization.create({
      data: { name: `other-${randomUUID()}`, currency: 'USD' },
    });
    orgId = org.id;
    otherId = other.id;
    ctx = { org, user: { id: ownerId }, role: 'OWNER', members: [] } as unknown as Context;
    const today = new Date();
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
    const previous = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1, 12));
    const old = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 8, 1, 12));
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'current.test',
        unicodeName: 'current.test',
        tld: 'test',
        createdAt: month,
        acquiredAt: month,
        acquisitionCost: '10',
        currency: 'USD',
        registrations: {
          create: [
            {
              registrar: 'First',
              expiresAt: month,
              renewalCost: '13',
              currency: 'USD',
              nameservers: [],
            },
            {
              registrar: 'Second',
              expiresAt: month,
              renewalCost: '99',
              currency: 'EUR',
              nameservers: [],
            },
          ],
        },
        sales: {
          create: {
            marketplace: 'Example',
            grossAmount: '100',
            currency: 'USD',
            payments: {
              create: [
                { amount: '10', currency: 'USD', receivedAt: month, reference: 'usd' },
                { amount: '50', currency: 'EUR', receivedAt: month, reference: 'eur' },
              ],
            },
          },
        },
      },
    });
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'old.test',
        unicodeName: 'old.test',
        tld: 'test',
        createdAt: old,
        acquiredAt: previous,
        acquisitionCost: '20',
        currency: 'USD',
      },
    });
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'deleted.test',
        unicodeName: 'deleted.test',
        tld: 'test',
        createdAt: month,
        acquiredAt: month,
        acquisitionCost: '5',
        currency: 'USD',
        deletedAt: new Date(),
      },
    });
    await db.domain.create({
      data: {
        organizationId: otherId,
        name: 'foreign.test',
        unicodeName: 'foreign.test',
        tld: 'test',
        createdAt: month,
        acquiredAt: month,
        acquisitionCost: '999',
        currency: 'USD',
        registrations: {
          create: {
            registrar: 'Other',
            expiresAt: month,
            renewalCost: '999',
            currency: 'USD',
            nameservers: [],
          },
        },
        sales: {
          create: {
            marketplace: 'Other',
            grossAmount: '999',
            currency: 'USD',
            payments: {
              create: { amount: '999', currency: 'USD', receivedAt: month, reference: 'foreign' },
            },
          },
        },
      },
    });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherId] } } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });
  it('keeps month buckets, currency filters, deleted-row semantics and workspace isolation', async () => {
    const result = await dashboard(ctx);
    expect(result.monthly).toHaveLength(6);
    expect(result.monthly.at(-1)).toMatchObject({ collected: '10.00', acquisition: '15.00' });
    expect(result.monthly.at(-2)).toMatchObject({ collected: '0', acquisition: '20.00' });
    expect(result.growth.map((item) => item.total)).toEqual([1, 1, 1, 1, 1, 2]);
    expect(result.renewalMonths).toHaveLength(12);
    expect(result.renewalMonths[0]).toMatchObject({ count: 2, cost: '13.00' });
  });
});
