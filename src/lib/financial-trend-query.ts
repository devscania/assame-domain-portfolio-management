import { db } from './db';
import Decimal from 'decimal.js';
import type { Context } from './access';
import {
  financialTrendBounds,
  financialTrendBuckets,
  financialTrendSnapshot,
  type FinancialTotals,
  type TrendPeriod,
} from './financial-trends';

/** Actual dated receipt/acquisition/expense records; never reconstructed inventory snapshots. */
export async function financialTrends(ctx: Context, period: TrendPeriod, now = new Date()) {
  return db.$transaction(
    async (tx) => {
      const org = ctx.org.id,
        currency = ctx.org.currency;
      const earliest =
        period === 'all'
          ? await tx.$queryRaw<{ at: Date | null }[]>`
    SELECT MIN(at) AS at FROM (
      SELECT MIN(p."receivedAt") AS at FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND p.currency=${currency} AND p.amount<>0 AND p."receivedAt"<${now}
      UNION ALL SELECT MIN(d."acquiredAt") FROM "Domain" d WHERE d."organizationId"=${org} AND d.currency=${currency} AND d."acquisitionCost"<>0 AND d."acquiredAt"<${now}
      UNION ALL SELECT MIN(e."occurredAt") FROM "DomainExpense" e JOIN "Domain" d ON d.id=e."domainId" WHERE d."organizationId"=${org} AND e.currency=${currency} AND e.amount<>0 AND e."occurredAt"<${now}
    ) dated`
          : [];
      const earliestDate = earliest[0]?.at ?? undefined;
      const bounds = financialTrendBounds(period, now, earliestDate);
      const previousStart = new Date(bounds.previousStart),
        start = new Date(bounds.start),
        end = new Date(bounds.end),
        previousEnd = new Date(bounds.previousEnd);
      const bucketSeconds = bounds.intervalDays * 86400;
      const rows = await tx.$queryRaw<
        {
          kind: keyof FinancialTotals;
          band: 'current' | 'previous' | 'undated';
          amount: string;
          count: number;
          bucket: number | null;
        }[]
      >`
    WITH events AS (
      SELECT 'collected' AS kind,p.amount,p."receivedAt" AS at
      FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId"
      WHERE d."organizationId"=${org} AND p.currency=${currency} AND p.amount<>0
        AND (p."receivedAt" IS NULL OR (p."receivedAt">=${previousStart} AND p."receivedAt"<${end}))
      UNION ALL
      SELECT 'acquisition',d."acquisitionCost",d."acquiredAt"
      FROM "Domain" d
      WHERE d."organizationId"=${org} AND d.currency=${currency} AND d."acquisitionCost"<>0
        AND (d."acquiredAt" IS NULL OR (d."acquiredAt">=${previousStart} AND d."acquiredAt"<${end}))
      UNION ALL
      SELECT 'expenses',e.amount,e."occurredAt"
      FROM "DomainExpense" e JOIN "Domain" d ON d.id=e."domainId"
      WHERE d."organizationId"=${org} AND e.currency=${currency} AND e.amount<>0
        AND (e."occurredAt" IS NULL OR (e."occurredAt">=${previousStart} AND e."occurredAt"<${end}))
    )
    SELECT kind,CASE WHEN at IS NULL THEN 'undated' WHEN at>=${start} THEN 'current' ELSE 'previous' END AS band,
      SUM(amount)::text AS amount,COUNT(*)::int AS count,
      CASE WHEN at>=${start} THEN FLOOR(EXTRACT(EPOCH FROM (at-${start}::timestamp))/${bucketSeconds})::int ELSE NULL END AS bucket
    FROM events WHERE at IS NULL OR (at>=${start} AND at<${end}) OR (at>=${previousStart} AND at<${previousEnd}) GROUP BY kind,band,bucket`;
      const zero = () => ({ collected: '0.00', acquisition: '0.00', expenses: '0.00' });
      const totals = { current: zero(), previous: zero() };
      const undated = { collected: 0, acquisition: 0, expenses: 0 };
      const series = financialTrendBuckets(period, now, earliestDate);
      for (const row of rows) {
        if (row.band === 'undated') undated[row.kind] += row.count;
        else {
          totals[row.band][row.kind] = new Decimal(totals[row.band][row.kind])
            .plus(row.amount)
            .toFixed(2);
          if (row.band === 'current' && row.bucket !== null) {
            const key = row.kind === 'collected' ? 'collected' : 'spending';
            series[row.bucket][key] = new Decimal(series[row.bucket][key])
              .plus(row.amount)
              .toFixed(2);
          }
        }
      }
      return financialTrendSnapshot({
        period,
        currency,
        now,
        ...totals,
        undated,
        series,
        earliestDate,
      });
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
