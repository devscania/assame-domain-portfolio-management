import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import type { Context } from '../src/lib/access';
import { financialTrends } from '../src/lib/financial-trend-query';
import { financialTrendBounds } from '../src/lib/financial-trends';
const now = new Date('2026-11-10T12:00:00Z');
const bounds = financialTrendBounds('7d', now);
const current = new Date(bounds.start),
  previous = new Date(bounds.previousStart);
describe.skipIf(!process.env.TEST_DATABASE_URL)('persisted dated cash flow', () => {
  let org = '',
    other = '',
    main = '',
    sale = '';
  const ctx = () => ({ org: { id: org, currency: 'USD' } }) as Context;
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    org = (await db.organization.create({ data: { name: 'Trend fixture' } })).id;
    other = (await db.organization.create({ data: { name: 'Other trend fixture' } })).id;
    async function domain(
      name: string,
      cost: string,
      at: Date,
      currency = 'USD',
      organizationId = org,
      deletedAt: Date | null = null,
      status = 'active',
    ) {
      return db.domain.create({
        data: {
          name,
          unicodeName: name,
          tld: 'test',
          organizationId,
          currency,
          acquisitionCost: cost,
          acquiredAt: at,
          deletedAt,
          status,
        },
      });
    }
    const a = await domain('trend-current.test', '100', current);
    main = a.id;
    await domain('trend-previous.test', '200', previous);
    const soft = await domain('trend-deleted.test', '20', current, 'USD', org, now);
    const archived = await domain(
      'trend-archived.test',
      '10',
      previous,
      'USD',
      org,
      null,
      'archived',
    );
    const eur = await domain('trend-eur.test', '999', current, 'EUR');
    const foreign = await domain('trend-private.test', '999', current, 'USD', other);
    async function receipt(
      domainId: string,
      amount: string,
      at: Date | null,
      currency = 'USD',
      reference = 'fixture',
    ) {
      const row = await db.domainSale.create({
        data: {
          domainId,
          marketplace: 'Fixture',
          grossAmount: amount,
          currency,
          soldAt: current,
          payments: { create: { amount, currency, receivedAt: at, reference } },
        },
      });
      return row.id;
    }
    sale = await receipt(a.id, '1000', current);
    await receipt(a.id, '600', previous);
    await receipt(a.id, '500', now); // End is exclusive.
    await receipt(a.id, '700', new Date(previous.getTime() - 1));
    await receipt(soft.id, '30', current);
    await receipt(archived.id, '20', previous);
    await receipt(eur.id, '999', current, 'EUR');
    await receipt(foreign.id, '9999', current);
    await db.domainExpense.createMany({
      data: [
        { domainId: a.id, category: 'renewal', amount: '40', currency: 'USD', occurredAt: current },
        {
          domainId: a.id,
          category: 'holding',
          amount: '100',
          currency: 'USD',
          occurredAt: previous,
        },
        {
          domainId: soft.id,
          category: 'holding',
          amount: '5',
          currency: 'USD',
          occurredAt: new Date(current.getTime() + 2 * 86400000),
        },
        {
          domainId: archived.id,
          category: 'holding',
          amount: '5',
          currency: 'USD',
          occurredAt: previous,
        },
        {
          domainId: eur.id,
          category: 'holding',
          amount: '999',
          currency: 'EUR',
          occurredAt: current,
        },
        {
          domainId: foreign.id,
          category: 'holding',
          amount: '999',
          currency: 'USD',
          occurredAt: current,
        },
      ],
    });
    await db.domainRenewal.create({
      data: {
        domainId: a.id,
        amount: '40',
        currency: 'USD',
        confirmedAt: current,
        expiresAt: new Date('2027-11-10T00:00:00Z'),
      },
    });
    await db.domainRegistration.create({
      data: {
        domainId: a.id,
        registrar: 'Fixture',
        registeredAt: new Date('2020-01-01'),
        renewalCost: '999',
        currency: 'USD',
      },
    });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.$disconnect();
  });
  it('uses account/currency-scoped dated events, preserves soft-deleted and archived history, and never doubles renewal records or estimates', async () => {
    const result = await financialTrends(ctx(), '7d', now);
    expect(result.metrics.collected).toMatchObject({ current: '1030.00', previous: '620.00' });
    expect(result.metrics.spending).toMatchObject({ current: '165.00', previous: '315.00' });
    expect(result.metrics.netCash).toMatchObject({
      current: '865.00',
      previous: '305.00',
      change: { direction: 'up', percent: '183.6' },
    });
    expect(result.series).toHaveLength(7);
    expect(result.series[2].spending).toBe('5.00');
    expect(result.series.reduce((sum, item) => sum + Number(item.netCash), 0)).toBe(865);
  });
  it('marks undated nonzero acquisition history unavailable instead of guessing its period', async () => {
    await db.domain.update({ where: { id: main }, data: { acquiredAt: null } });
    try {
      const result = await financialTrends(ctx(), '7d', now);
      expect(result.undated.acquisition).toBe(1);
      expect(result.metrics.netCash.current).toBeNull();
      expect(result.metrics.spending.change.direction).toBe('unavailable');
      expect(result.series.reduce((sum, item) => sum + Number(item.collected), 0)).toBe(1030);
      expect(result.series.reduce((sum, item) => sum + Number(item.spending), 0)).toBe(65);
      expect(result.metrics.collected.current).toBe('1030.00');
    } finally {
      await db.domain.update({ where: { id: main }, data: { acquiredAt: current } });
    }
  });
  it('does not allocate a provider receipt with no received date to the current window', async () => {
    const payment = await db.salePayment.create({
      data: { saleId: sale, amount: '5', currency: 'USD', reference: 'undated', receivedAt: null },
    });
    try {
      const result = await financialTrends(ctx(), '7d', now);
      expect(result.undated.collected).toBe(1);
      expect(result.metrics.collected.current).toBeNull();
      expect(result.metrics.netCash.change.direction).toBe('unavailable');
      expect(result.metrics.spending.current).toBe('165.00');
      expect(result.series.reduce((sum, item) => sum + Number(item.collected), 0)).toBe(1030);
    } finally {
      await db.salePayment.delete({ where: { id: payment.id } });
    }
  });
  it('excludes the gap outside prior YTD and derives all-time bounds from a consistent persisted history', async () => {
    const past = await db.salePayment.create({
      data: {
        saleId: sale,
        amount: '40',
        currency: 'USD',
        reference: 'prior-ytd',
        receivedAt: new Date('2025-07-01T00:00:00Z'),
      },
    });
    const gap = await db.salePayment.create({
      data: {
        saleId: sale,
        amount: '900',
        currency: 'USD',
        reference: 'outside-ytd',
        receivedAt: new Date('2025-12-01T00:00:00Z'),
      },
    });
    try {
      const ytd = await financialTrends(ctx(), 'ytd', now);
      expect(ytd.metrics.collected.previous).toBe('40.00');
      expect(ytd.metrics.collected.current).toBe('2350.00');
      const all = await financialTrends(ctx(), 'all', now);
      expect(all.start).toBe('2025-07-01T00:00:00.000Z');
      expect(all.series.length).toBeLessThanOrEqual(120);
      expect(all.metrics.collected.current).toBe('3290.00');
      expect(all.metrics.netCash.previous).toBeNull();
      expect(all.metrics.netCash.change.percent).toBeNull();
    } finally {
      await db.salePayment.deleteMany({ where: { id: { in: [past.id, gap.id] } } });
    }
  });
});
