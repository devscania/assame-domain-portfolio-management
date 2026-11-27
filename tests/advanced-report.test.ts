import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { advancedFinancialReport } from '../src/lib/advanced-report';
import type { Context } from '../src/lib/access';

describe.skipIf(!process.env.TEST_DATABASE_URL)('advanced financial reporting', () => {
  let ownerId = '',
    orgId = '',
    otherId = '';
  let ctx: Context;
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('Dedicated test database required');
    const owner = await db.user.create({ data: { email: `report-${randomUUID()}@example.test` } });
    ownerId = owner.id;
    const org = await db.organization.create({
      data: { name: 'Report fixture', currency: 'USD', workspaceOwnerId: ownerId },
    });
    orgId = org.id;
    const other = await db.organization.create({
      data: { name: 'Other fixture', currency: 'USD', workspaceOwnerId: ownerId },
    });
    otherId = other.id;
    ctx = { org, user: { id: ownerId } } as Context;
    for (const [organizationId, name, amount] of [
      [orgId, 'first.test', '25'],
      [otherId, 'second.test', '1000'],
    ]) {
      const domain = await db.domain.create({
        data: { organizationId, name, unicodeName: name, tld: 'test' },
      });
      const sale = await db.domainSale.create({
        data: { domainId: domain.id, marketplace: 'manual', grossAmount: amount, currency: 'USD' },
      });
      await db.salePayment.create({
        data: {
          saleId: sale.id,
          amount,
          currency: 'USD',
          reference: 'dated',
          receivedAt: new Date(),
        },
      });
      await db.salePayment.create({
        data: {
          saleId: sale.id,
          amount: '5',
          currency: 'USD',
          reference: 'undated',
          receivedAt: null,
        },
      });
      await db.salePayment.create({
        data: {
          saleId: sale.id,
          amount: '20',
          currency: 'EUR',
          reference: 'other-currency',
          receivedAt: new Date(),
        },
      });
    }
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherId] } } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });
  it('reports dated agreements and receipts without a subscription', async () => {
    const report = await advancedFinancialReport(ctx);
    expect(report.months).toHaveLength(12);
    expect(report.months[0]).toMatchObject({
      agreements: '25.00',
      agreementCount: 1,
      received: '25.00',
      paymentCount: 1,
    });
    expect(report.undated).toEqual({ amount: '5.00', count: 1 });
  });
});
