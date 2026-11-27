import { db } from './db';
import { workerDispatchHealth } from './worker-health';
import Decimal from 'decimal.js';
import { availableProviderIds } from '@/integrations/catalog';
import { marketplaceCounters } from './marketplace-analytics';
import type { Context } from './access';
import { workspaceNotifications } from './workspace-notifications';
import { workspaceActivity } from './workspace-activity';
export async function dashboard(ctx: Context) {
  const org = ctx.org.id;
  const currency = ctx.org.currency;
  const [
    totals,
    listing,
    renewal,
    cash,
    profit,
    issues,
    monthly,
    tlds,
    registrars,
    activity,
    upcoming,
    sales,
    accounts,
    notifications,
    growth,
    renewalWindows,
    renewalMonths,
    marketplaces,
    ageBands,
    salesMarketplaces,
  ] = await Promise.all([
    db.domain.aggregate({ where: { organizationId: org, deletedAt: null }, _count: true }),
    db.$queryRaw<{ value: string; domainCount: number; listingCount: number }[]>`
      SELECT COALESCE(SUM(bin), 0)::text AS value,
        COUNT(bin)::int AS "domainCount",
        COALESCE(SUM(listings), 0)::int AS "listingCount"
      FROM (
        SELECT MIN(l."binPrice") FILTER (WHERE l."binPrice" > 0) AS bin, COUNT(*) AS listings
        FROM "DomainListing" l
        JOIN "Domain" d ON d.id = l."domainId"
        WHERE d."organizationId" = ${org} AND d."deletedAt" IS NULL AND l.currency = ${currency}
          AND (lower(l.status) IN ('listed', 'active', 'onsale')
            OR (l.marketplace = 'atom' AND lower(l.status) IN ('approved', 'seller approved')))
        GROUP BY l."domainId"
      ) per_domain
    `,
    db.domainRegistration.aggregate({
      where: {
        domain: { organizationId: org, deletedAt: null, status: 'active' },
        currency,
        expiresAt: { gte: new Date(), lte: new Date(Date.now() + 365 * 86400000) },
      },
      _sum: { renewalCost: true },
    }),
    db.$queryRaw<
      {
        collected: string;
        gross: string;
        commission: string;
        unpaid: string;
        undatedCash: string;
      }[]
    >`SELECT COALESCE((SELECT SUM(p.amount) FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND p.currency=${currency}),0)::text collected, COALESCE(SUM(s."grossAmount"),0)::text gross, COALESCE((SELECT SUM(c.amount) FROM "Commission" c JOIN "DomainSale" s ON s.id=c."saleId" JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND c.currency=${currency}),0)::text commission, (COALESCE(SUM(s."grossAmount"),0)-COALESCE((SELECT SUM(p.amount+p."commissionWithheld") FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND p.currency=${currency}),0))::text unpaid,COALESCE((SELECT SUM(p.amount) FROM "SalePayment" p JOIN "DomainSale" s2 ON s2.id=p."saleId" JOIN "Domain" d2 ON d2.id=s2."domainId" WHERE d2."organizationId"=${org} AND p.currency=${currency} AND p."receivedAt" IS NULL),0)::text "undatedCash" FROM "DomainSale" s JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND s.currency=${currency}`,
    db.$queryRaw<
      { investment: string; realized: string; expenses: string; renewals: string }[]
    >`
      WITH workspace_domains AS (
        SELECT id, currency, "acquisitionCost", "acquiredAt", "deletedAt"
        FROM "Domain" WHERE "organizationId" = ${org}
      ), recorded_expenses AS (
        SELECT e."domainId", e.amount, e."occurredAt", lower(e.category) AS category
        FROM "DomainExpense" e JOIN workspace_domains d ON d.id = e."domainId"
        WHERE e.currency = ${currency}
      ), renewal_expenses AS (
        SELECT "domainId", amount, "occurredAt" FROM recorded_expenses WHERE category = 'renewal'
      ), unmatched_renewals AS (
        -- Manual confirmation writes both rows at the same transaction timestamp.
        -- Subtract one matching expense per confirmation and keep additional payments.
        SELECT r."domainId", r.amount, r."confirmedAt"
        FROM "DomainRenewal" r JOIN workspace_domains d ON d.id = r."domainId"
        WHERE r.currency = ${currency}
        EXCEPT ALL
        SELECT "domainId", amount, "occurredAt" FROM renewal_expenses
      ), recorded_renewals AS (
        SELECT "domainId", SUM(amount) AS amount FROM (
          SELECT "domainId", amount FROM renewal_expenses
          UNION ALL
          SELECT "domainId", amount FROM unmatched_renewals
        ) payments GROUP BY "domainId"
      ), renewal_estimates AS (
        SELECT r."domainId", SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
          NOW() - COALESCE(d."acquiredAt", r."registeredAt", NOW())
        )) / (365.25 * 86400))) * r."renewalCost") AS amount
        FROM "DomainRegistration" r JOIN workspace_domains d ON d.id = r."domainId"
        WHERE d."deletedAt" IS NULL AND d.currency = ${currency} AND r.currency = ${currency}
        GROUP BY r."domainId"
      )
      SELECT
        COALESCE((SELECT SUM("acquisitionCost") FROM workspace_domains WHERE currency = ${currency}), 0)::text investment,
        COALESCE((SELECT SUM(amount) FROM recorded_expenses WHERE category <> 'renewal'), 0)::text expenses,
        COALESCE((
          SELECT SUM(GREATEST(p.amount, e.amount))
          FROM recorded_renewals p FULL JOIN renewal_estimates e USING ("domainId")
        ), 0)::text renewals,
        COALESCE((
          SELECT SUM(s."grossAmount" - d."acquisitionCost"
            - COALESCE((SELECT SUM(c.amount) FROM "Commission" c WHERE c."saleId" = s.id AND c.currency = ${currency}), 0)
            - COALESCE((SELECT SUM(e.amount) FROM "DomainExpense" e WHERE e."domainId" = d.id AND e.currency = ${currency}), 0)
            + COALESCE((SELECT SUM(a.amount) FROM "FinancialAdjustment" a WHERE a."saleId" = s.id AND a.currency = ${currency}), 0))
          FROM "DomainSale" s JOIN workspace_domains d ON d.id = s."domainId"
          WHERE s.currency = ${currency} AND s.status = 'completed'
        ), 0)::text realized
    `,
    db.$queryRaw<
      { conflicts: number; missing: number; expiring: number }[]
    >`SELECT (SELECT COUNT(*)::int FROM (SELECT l."domainId" FROM "DomainListing" l JOIN "Domain" d ON d.id=l."domainId" WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL GROUP BY l."domainId" HAVING COUNT(DISTINCT (l.currency,l."binPrice")) FILTER (WHERE l."binPrice" IS NOT NULL)>1) a) conflicts, (SELECT COUNT(*)::int FROM "Domain" d WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d.status='active' AND NOT EXISTS(SELECT 1 FROM "DomainListing" l WHERE l."domainId"=d.id)) missing, (SELECT COUNT(DISTINCT r."domainId")::int FROM "DomainRegistration" r JOIN "Domain" d ON d.id=r."domainId" WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d.status='active' AND r."expiresAt" BETWEEN NOW() AND NOW()+interval '30 days') expiring`,
    db.$queryRaw<
      { month: string; collected: string; acquisition: string }[]
    >`WITH bounds AS (SELECT date_trunc('month', NOW()) - interval '5 months' AS start_month, date_trunc('month', NOW()) + interval '1 month' AS end_month),
      payments AS (SELECT date_trunc('month', p."receivedAt") AS month, SUM(p.amount) AS total FROM "SalePayment" p JOIN "DomainSale" s ON s.id=p."saleId" JOIN "Domain" d ON d.id=s."domainId" CROSS JOIN bounds b WHERE d."organizationId"=${org} AND p.currency=${currency} AND p."receivedAt">=b.start_month AND p."receivedAt"<b.end_month GROUP BY 1),
      acquisitions AS (SELECT date_trunc('month', d."acquiredAt") AS month, SUM(d."acquisitionCost") AS total FROM "Domain" d CROSS JOIN bounds b WHERE d."organizationId"=${org} AND d.currency=${currency} AND d."acquiredAt">=b.start_month AND d."acquiredAt"<b.end_month GROUP BY 1)
      SELECT to_char(m,'Mon') AS "month", COALESCE(p.total,0)::text collected, COALESCE(a.total,0)::text acquisition FROM bounds b CROSS JOIN LATERAL generate_series(b.start_month,b.end_month-interval '1 month',interval '1 month') m LEFT JOIN payments p ON p.month=m LEFT JOIN acquisitions a ON a.month=m ORDER BY m`,
    db.domain.groupBy({
      by: ['tld'],
      where: { organizationId: org, deletedAt: null },
      _count: true,
      orderBy: { _count: { tld: 'desc' } },
      take: 10,
    }),
    db.domainRegistration.groupBy({
      by: ['registrar'],
      where: { domain: { organizationId: org, deletedAt: null } },
      _count: true,
      orderBy: [{ _count: { registrar: 'desc' } }, { registrar: 'asc' }],
    }),
    workspaceActivity(org, 7),
    db.domainRegistration.findMany({
      where: {
        domain: { organizationId: org, deletedAt: null, status: 'active' },
        expiresAt: { not: null },
      },
      include: { domain: { select: { id: true, name: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 8,
    }),
    db.domainSale.findMany({
      where: { domain: { organizationId: org } },
      include: {
        domain: {
          select: {
            name: true,
            acquisitionCost: true,
            expenses: { select: { amount: true, currency: true } },
          },
        },
        payments: true,
        commissions: true,
        installments: true,
        adjustments: true,
      },
      orderBy: { soldAt: 'desc' },
      take: 100,
    }),
    db.providerAccount.findMany({
      where: { organizationId: org, providerId: { in: availableProviderIds }, status: { not: 'removed' } },
      select: {
        id: true,
        label: true,
        providerId: true,
        status: true,
        lastSyncAt: true,
        syncEveryHours: true,
      },
    }),
    workspaceNotifications(org, ctx.user.id!),
    db.$queryRaw<
      { month: string; total: number }[]
    >`WITH bounds AS (SELECT date_trunc('month',NOW())-interval '5 months' AS start_month, date_trunc('month',NOW())+interval '1 month' AS end_month),
      prior AS (SELECT COUNT(*)::int AS total FROM "Domain" d CROSS JOIN bounds b WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d."createdAt"<b.start_month),
      monthly AS (SELECT date_trunc('month',d."createdAt") AS month, COUNT(*)::int AS total FROM "Domain" d CROSS JOIN bounds b WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d."createdAt">=b.start_month AND d."createdAt"<b.end_month GROUP BY 1)
      SELECT to_char(m,'Mon') AS "month", (prior.total + SUM(COALESCE(monthly.total,0)) OVER (ORDER BY m))::int AS total FROM bounds b CROSS JOIN prior CROSS JOIN LATERAL generate_series(b.start_month,b.end_month-interval '1 month',interval '1 month') m LEFT JOIN monthly ON monthly.month=m ORDER BY m`,
    db.$queryRaw<
      { days7: number; days30: number; days60: number; days90: number; overdue: number }[]
    >`SELECT COUNT(*) FILTER(WHERE r."expiresAt" BETWEEN NOW() AND NOW()+interval '7 days')::int "days7", COUNT(*) FILTER(WHERE r."expiresAt" BETWEEN NOW() AND NOW()+interval '30 days')::int "days30", COUNT(*) FILTER(WHERE r."expiresAt" BETWEEN NOW() AND NOW()+interval '60 days')::int "days60", COUNT(*) FILTER(WHERE r."expiresAt" BETWEEN NOW() AND NOW()+interval '90 days')::int "days90", COUNT(*) FILTER(WHERE r."expiresAt" < NOW())::int overdue FROM "DomainRegistration" r JOIN "Domain" d ON d.id=r."domainId" WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d.status='active'`,
    db.$queryRaw<
      { month: string; label: string; count: number; cost: string }[]
    >`WITH bounds AS (SELECT date_trunc('month', NOW() AT TIME ZONE 'UTC') AS start_month, date_trunc('month', NOW() AT TIME ZONE 'UTC') + interval '12 months' AS end_month),
      monthly AS (SELECT date_trunc('month',r."expiresAt") AS month, COUNT(*)::int AS count, SUM(r."renewalCost") FILTER (WHERE r.currency=${currency}) AS cost FROM "DomainRegistration" r JOIN "Domain" d ON d.id=r."domainId" CROSS JOIN bounds b WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL AND d.status='active' AND r."expiresAt">=b.start_month AND r."expiresAt"<b.end_month GROUP BY 1)
      SELECT to_char(m,'YYYY-MM') AS month,to_char(m,'Mon YYYY') AS label, COALESCE(monthly.count,0)::int AS count, COALESCE(monthly.cost,0)::text AS cost FROM bounds b CROSS JOIN LATERAL generate_series(b.start_month,b.end_month-interval '1 month',interval '1 month') m LEFT JOIN monthly ON monthly.month=m ORDER BY m`,
    db.domainListing.groupBy({
      by: ['marketplace'],
      where: { domain: { organizationId: org, deletedAt: null } },
      _count: true,
    }),
    db.$queryRaw<
      { label: string; value: number }[]
    >`SELECT CASE WHEN r."registeredAt">NOW()-interval '1 year' THEN 'Under 1 year' WHEN r."registeredAt">NOW()-interval '3 years' THEN '1–3 years' WHEN r."registeredAt" IS NULL THEN 'Unknown' ELSE '3+ years' END label, COUNT(*)::int value FROM "DomainRegistration" r JOIN "Domain" d ON d.id=r."domainId" WHERE d."organizationId"=${org} AND d."deletedAt" IS NULL GROUP BY label`,
    db.$queryRaw<
      { marketplace: string; agreements: string; collected: string; count: number }[]
    >`SELECT s.marketplace, SUM(s."grossAmount")::text agreements, COALESCE(SUM((SELECT SUM(p.amount) FROM "SalePayment" p WHERE p."saleId"=s.id)),0)::text collected, COUNT(*)::int count FROM "DomainSale" s JOIN "Domain" d ON d.id=s."domainId" WHERE d."organizationId"=${org} AND s.currency=${currency} GROUP BY s.marketplace`,
  ]);
  const observations = await db.providerSaleObservation.findMany({
    where: { account: { organizationId: org } },
    select: {
      id: true,
      domainName: true,
      status: true,
      kind: true,
      amount: true,
      currency: true,
      soldAt: true,
      installments: true,
      installmentsPaid: true,
      observedAt: true,
      commissionAmount: true,
      installmentAmount: true,
      nextInstallmentAt: true,
      account: { select: { providerId: true, label: true } },
    },
    orderBy: { observedAt: 'desc' },
    take: 100,
  });
  const observedDomains = await db.domain.findMany({
    where: { organizationId: org, name: { in: observations.map((s) => s.domainName) } },
    include: { expenses: true, sales: { select: { id: true }, take: 1 } },
  });
  const byName = new Map(observedDomains.map((d) => [d.name, d]));
  const totalInvestment = new Decimal(profit[0]?.investment || '0')
    .plus(profit[0]?.expenses || '0')
    .plus(profit[0]?.renewals || '0');
  return {
    marketplaceCounters: await marketplaceCounters(ctx),
    workerConnected: (await workerDispatchHealth()).recent,
    providerSales: observations.map((s) => {
      const d = byName.get(s.domainName);
      return {
        ...s,
        domainId: d?.id ?? null,
        hasLedgerSale: !!d?.sales.length,
        recordedInvestment:
          d && d.currency === s.currency
            ? d.expenses
                .filter((e) => e.currency === s.currency)
                .reduce((sum, e) => sum.plus(e.amount), new Decimal(d.acquisitionCost))
                .toFixed(2)
            : null,
      };
    }),
    providerStats: await db.$queryRaw<
      { date: string; views: number; leads: number }[]
    >`SELECT to_char(a.date,'YYYY-MM-DD') date, SUM(a.views)::int views, SUM(a.leads)::int leads FROM "ProviderAnalytics" a JOIN "ProviderAccount" p ON p.id=a."providerAccountId" WHERE p."organizationId"=${org} AND a.date >= NOW()-interval '30 days' GROUP BY a.date ORDER BY a.date`,
    total: totals._count,
    listingValue: listing[0].value,
    listedBinDomainCount: listing[0].domainCount,
    listingCount: listing[0].listingCount,
    renewalForecast: renewal._sum.renewalCost?.toString() ?? '0',
    ...cash[0],
    ...profit[0],
    totalInvestment: totalInvestment.toFixed(2),
    renewals: new Decimal(profit[0]?.renewals || '0').toFixed(2),
    netReturn: new Decimal(cash[0]?.collected || '0').minus(totalInvestment).toFixed(2),
    ...issues[0],
    monthly,
    growth,
    renewalWindows: renewalWindows[0],
    renewalMonths,
    marketplaces,
    ageBands,
    salesMarketplaces,
    tlds,
    registrars,
    activity,
    upcoming,
    sales,
    accounts,
    notifications,
    currency,
  };
}
