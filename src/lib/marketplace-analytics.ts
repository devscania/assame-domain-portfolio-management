import { db } from './db';
import type { Context } from './access';

export async function marketplaceCounters(ctx: Context) {
  return db.$queryRaw<
    {
      marketplace: string;
      listingCount: number;
      observedCount: number;
      verifiedCount: number;
      views: string | null;
      leads: string | null;
      offers: string | null;
      shortlists: string | null;
      lastObservedAt: string | null;
    }[]
  >`
    SELECT l.marketplace,COUNT(*)::int AS "listingCount",
      COUNT(*) FILTER(WHERE (jsonb_typeof(l.analytics->'views')='number' OR jsonb_typeof(l.analytics->'leads')='number' OR jsonb_typeof(l.analytics->'offers')='number' OR jsonb_typeof(l.analytics->'shortlists')='number'))::int AS "observedCount",
      COUNT(*) FILTER(WHERE (jsonb_typeof(l.analytics->'views')='number' OR jsonb_typeof(l.analytics->'leads')='number' OR jsonb_typeof(l.analytics->'offers')='number' OR jsonb_typeof(l.analytics->'shortlists')='number') AND l."verifiedAt" IS NOT NULL AND l.source=l.marketplace)::int AS "verifiedCount",
      SUM(CASE WHEN jsonb_typeof(l.analytics->'views')='number' THEN (l.analytics->>'views')::numeric END)::text AS views,
      SUM(CASE WHEN jsonb_typeof(l.analytics->'leads')='number' THEN (l.analytics->>'leads')::numeric END)::text AS leads,
      SUM(CASE WHEN jsonb_typeof(l.analytics->'offers')='number' THEN (l.analytics->>'offers')::numeric END)::text AS offers,
      SUM(CASE WHEN jsonb_typeof(l.analytics->'shortlists')='number' THEN (l.analytics->>'shortlists')::numeric END)::text AS shortlists,
      MAX(l.analytics->>'observedAt') AS "lastObservedAt"
    FROM "DomainListing" l JOIN "Domain" d ON d.id=l."domainId"
    WHERE d."organizationId"=${ctx.org.id} AND d."deletedAt" IS NULL GROUP BY l.marketplace`;
}
