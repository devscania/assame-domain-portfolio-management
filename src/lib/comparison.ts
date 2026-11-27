import { Prisma } from '@prisma/client';
import { db } from './db';
import type { Context } from './access';

import { comparisonLabels, type Comparison } from './comparison-labels';
import { expirationWindow } from './expiration';

// Both sorting and filtering run over the full filtered portfolio in PostgreSQL,
// before pagination. Never sort just the currently visible browser page.
export async function comparisonPage(
  ctx: Context,
  query: URLSearchParams,
  page: number,
  take: number,
) {
  return comparisonQuery(ctx, query, page, take);
}

/** Export in stable ID order; avoid repeated full-portfolio counts and offsets. */
export async function comparisonExportPage(
  ctx: Context,
  query: URLSearchParams,
  after: string | undefined,
  take: number,
) {
  return comparisonQuery(ctx, query, 1, take, { after });
}

async function comparisonQuery(
  ctx: Context,
  query: URLSearchParams,
  page: number,
  take: number,
  exportOptions?: { after?: string },
) {
  const filters: Prisma.Sql[] = [
    Prisma.sql`d."organizationId"=${ctx.org.id}`,
    Prisma.sql`d."deletedAt" IS NULL`,
  ];
  if (exportOptions?.after) filters.push(Prisma.sql`d.id>${exportOptions.after}`);
  const search = (query.get('q') || '').slice(0, 253).toLowerCase();
  if (search) filters.push(Prisma.sql`strpos(lower(d.name),${search})>0`);
  if (query.get('tld')) filters.push(Prisma.sql`d.tld=${query.get('tld')}`);
  const status = query.get('status');
  if (status) {
    if (status !== 'all') filters.push(Prisma.sql`d.status=${status}`);
  } else if (query.get('matrix') === 'true' || query.get('renewals') === 'true') {
    filters.push(Prisma.sql`d.status='active'`);
  }
  const registration: Prisma.Sql[] = [Prisma.sql`r."domainId"=d.id`];
  if (query.get('registrar')) registration.push(Prisma.sql`r.registrar=${query.get('registrar')}`);
  const expiration = expirationWindow(query);
  if (expiration?.lt) registration.push(Prisma.sql`r."expiresAt"<${expiration.lt}`);
  if (expiration?.gte) registration.push(Prisma.sql`r."expiresAt">=${expiration.gte}`);
  if (expiration?.lte) registration.push(Prisma.sql`r."expiresAt"<=${expiration.lte}`);
  if (registration.length > 1)
    filters.push(
      Prisma.sql`EXISTS(SELECT 1 FROM "DomainRegistration" r WHERE ${Prisma.join(registration, ' AND ')})`,
    );
  if (query.get('tag'))
    filters.push(
      Prisma.sql`EXISTS(SELECT 1 FROM "DomainTagAssignment" a JOIN "DomainTag" t ON t.id=a."tagId" WHERE a."domainId"=d.id AND t."organizationId"=${ctx.org.id} AND t.name=${query.get('tag')})`,
    );
  if (query.get('listing') === 'none')
    filters.push(
      Prisma.sql`NOT EXISTS(SELECT 1 FROM "DomainListing" absent WHERE absent."domainId"=d.id)`,
    );
  const condition = query.get('comparison');
  const comparisonFilter =
    query.get('attention') === 'price-mismatch'
      ? Prisma.sql`price_keys>1`
      : condition && condition in comparisonLabels
        ? Prisma.sql`comparison=${condition}`
        : Prisma.sql`TRUE`;
  const direction = query.get('direction') === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const sort = query.get('sort');
  const sortColumn =
    sort === 'comparison'
      ? Prisma.sql`rank`
      : sort === 'expiration'
        ? Prisma.sql`expiration`
        : sort === 'askingPrice'
          ? Prisma.sql`"askingPrice"`
          : sort === 'acquisitionCost'
            ? Prisma.sql`"acquisitionCost"`
            : sort === 'createdAt'
              ? Prisma.sql`"createdAt"`
              : sort === 'registrar'
                ? Prisma.sql`lower(registrar) COLLATE "C"`
                : sort === 'nameservers'
                  ? Prisma.sql`nameservers COLLATE "C"`
                : sort === 'status'
                  ? Prisma.sql`CASE lower(status)
                    WHEN 'active' THEN 1
                    WHEN 'pending' THEN 2
                    WHEN 'in_escrow' THEN 3
                    WHEN 'lto' THEN 4
                    WHEN 'sold' THEN 5
                    WHEN 'expired' THEN 6
                    ELSE 99 END`
                  : Prisma.sql`name`;
  const registrationOrder =
    sort === 'registrar'
      ? Prisma.sql`lower(r.registrar) COLLATE "C" ASC,r.registrar COLLATE "C" ASC,r.id ASC`
      : Prisma.sql`r."expiresAt" ASC NULLS LAST,r.id ASC`;
  const nameserverSortKey = sort === 'nameservers' ? Prisma.sql`
      (SELECT (SELECT string_agg(lower(btrim(host)), ',' ORDER BY lower(btrim(host)) COLLATE "C")
        FROM unnest(r.nameservers) AS ns(host) WHERE btrim(host) <> '')
        FROM "DomainRegistration" r WHERE ${Prisma.join(registration, ' AND ')}
        ORDER BY ${registrationOrder} LIMIT 1) AS nameservers,` : Prisma.empty;
  const cte = Prisma.sql`WITH stats AS (
    SELECT d.id,d.name,d."askingPrice",d."acquisitionCost",d."createdAt",d.status,
      (SELECT r.registrar FROM "DomainRegistration" r WHERE ${Prisma.join(registration, ' AND ')} ORDER BY ${registrationOrder} LIMIT 1) AS registrar,
      (SELECT r.id FROM "DomainRegistration" r WHERE ${Prisma.join(registration, ' AND ')} ORDER BY ${registrationOrder} LIMIT 1) AS "selectedRegistrationId",
      ${nameserverSortKey}
      (SELECT MIN(r."expiresAt") FROM "DomainRegistration" r WHERE ${Prisma.join(registration, ' AND ')}) AS expiration,
      COUNT(DISTINCT (l.currency,l."binPrice")) FILTER(WHERE l."binPrice" IS NOT NULL)::int AS price_keys,
      COUNT(l.id)::int AS listings,
      COUNT(l.id) FILTER(WHERE l."binPrice">0)::int AS priced,
      COUNT(DISTINCT l.currency) FILTER(WHERE l."binPrice">0)::int AS currencies,
      COUNT(DISTINCT l."binPrice") FILTER(WHERE l."binPrice">0)::int AS prices,
      COALESCE(BOOL_OR(l.stale),FALSE) AS stale
    FROM "Domain" d LEFT JOIN "DomainListing" l ON l."domainId"=d.id
    WHERE ${Prisma.join(filters, ' AND ')} GROUP BY d.id
  ), compared AS (
    SELECT *,CASE WHEN listings<2 THEN 'insufficient' WHEN stale THEN 'stale'
      WHEN currencies>1 THEN 'currency' WHEN priced<2 THEN 'unpriced'
      WHEN prices>1 THEN 'mismatch' ELSE 'match' END AS comparison FROM stats
  ), ranked AS (
    SELECT *,CASE comparison WHEN 'mismatch' THEN 5 WHEN 'currency' THEN 4
      WHEN 'stale' THEN 3 WHEN 'unpriced' THEN 2 WHEN 'insufficient' THEN 1 ELSE 0 END AS rank FROM compared
  )`;
  if (exportOptions) {
    const rows = await db.$queryRaw<
      { id: string; comparison: Comparison; selectedRegistrationId: string | null }[]
    >(
      Prisma.sql`${cte} SELECT id,comparison,"selectedRegistrationId" FROM ranked WHERE ${comparisonFilter} ORDER BY id ASC LIMIT ${take}`,
    );
    return { rows, total: 0 };
  }
  const [rows, count] = await db.$transaction([
    db.$queryRaw<{ id: string; comparison: Comparison; selectedRegistrationId: string | null }[]>(
      Prisma.sql`${cte} SELECT id,comparison,"selectedRegistrationId" FROM ranked WHERE ${comparisonFilter} ORDER BY ${sortColumn} ${direction} NULLS LAST,name ASC,id ASC LIMIT ${take} OFFSET ${(page - 1) * take}`,
    ),
    db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`${cte} SELECT COUNT(*) AS total FROM ranked WHERE ${comparisonFilter}`,
    ),
  ]);
  return { rows, total: Number(count[0].total) };
}
