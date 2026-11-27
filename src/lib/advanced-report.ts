import { db } from './db';
import type { Context } from './access';

/** Recorded agreements and actual receipts are distinct, and no currencies are converted. */
export async function advancedFinancialReport(ctx: Context) {
  const org = ctx.org.id;
  const currency = ctx.org.currency;
  return db.$transaction(async (tx) => {
    const months = await tx.$queryRaw<
      {
        month: string;
        agreements: string;
        agreementCount: number;
        received: string;
        paymentCount: number;
      }[]
    >`
      WITH bounds AS (
        SELECT date_trunc('month', NOW() AT TIME ZONE 'UTC') - interval '11 months' AS start_month,
               date_trunc('month', NOW() AT TIME ZONE 'UTC') + interval '1 month' AS end_month
      ), agreements AS (
        SELECT date_trunc('month', s."soldAt") AS month, SUM(s."grossAmount") AS total, COUNT(*)::int AS count
        FROM "DomainSale" s JOIN "Domain" d ON d.id=s."domainId" CROSS JOIN bounds b
        WHERE d."organizationId"=${org} AND s.currency=${currency}
          AND s."soldAt">=b.start_month AND s."soldAt"<b.end_month GROUP BY 1
      ), receipts AS (
        SELECT date_trunc('month', p."receivedAt") AS month, SUM(p.amount) AS total, COUNT(*)::int AS count
        FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId"
        JOIN "Domain" d ON d.id=s."domainId" CROSS JOIN bounds b
        WHERE d."organizationId"=${org} AND p.currency=${currency}
          AND p."receivedAt">=b.start_month AND p."receivedAt"<b.end_month GROUP BY 1
      )
      SELECT to_char(m,'YYYY-MM') AS month, COALESCE(a.total,0)::text AS agreements,
             COALESCE(a.count,0)::int AS "agreementCount", COALESCE(r.total,0)::text AS received,
             COALESCE(r.count,0)::int AS "paymentCount"
      FROM bounds b CROSS JOIN LATERAL generate_series(b.start_month,b.end_month-interval '1 month',interval '1 month') m
      LEFT JOIN agreements a ON a.month=m LEFT JOIN receipts r ON r.month=m ORDER BY m DESC`;
    const [undated] = await tx.$queryRaw<{ amount: string; count: number }[]>`
      SELECT COALESCE(SUM(p.amount),0)::text AS amount, COUNT(*)::int AS count
      FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId"
      WHERE d."organizationId"=${org} AND p.currency=${currency} AND p."receivedAt" IS NULL`;
    return { currency, months, undated };
  });
}
