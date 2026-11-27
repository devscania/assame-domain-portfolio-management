import { Prisma } from '@prisma/client';
import { db } from './db';
import { bulkActivity, bulkActivityActions } from './bulk-activity';
import { AppError } from './security';
import { providers, type ProviderId } from '@/integrations/catalog';

const labels: Record<string, string> = {
  'domain.created': 'Domain added',
  'domain.updated': 'Domain details updated',
  'domain.deleted': 'Domain removed',
  'domain.asking_price_updated': 'Asking price updated',
  'domain.acquisition_cost_updated': 'Acquisition cost updated',
  'domain.acquisition_cost_corrected': 'Acquisition cost corrected',
  'domain.renewal_cost_updated': 'Renewal cost updated',
  'domain.registrar_updated': 'Registrar updated',
  'domain.nameservers_updated': 'Nameservers updated',
  'domain.status_updated': 'Domain status updated',
  'registration.public_lookup': 'Registration details filled in',
  'registration.nameservers_recorded': 'Nameservers recorded',
  'renewal.manually_confirmed': 'Renewal recorded',
  'renewal.estimate_updated': 'Renewal estimate updated',
  'listing.price_confirmed': 'Marketplace price change queued',
  'listing.price_verified': 'Marketplace price change verified',
  'listing.price_failed': 'Marketplace price change failed',
  'listing.price_unverified': 'Marketplace price needs verification',
  'listing.statistics_queued': 'Listing statistics refresh queued',
  'listing.statistics_completed': 'Listing statistics refreshed',
  'listing.statistics_partial': 'Some listing statistics refreshed',
  'listing.statistics_failed': 'Listing statistics refresh failed',
  'provider.change_confirmed': 'Provider change queued',
  'provider.change_verified': 'Provider change verified',
  'provider.change_failed': 'Provider change failed',
  'provider.change_unverified': 'Provider change could not be verified',
  'provider.nameserver_confirmation_recheck': 'Nameserver change rechecked',
  'credentials.saved': 'Connection details saved',
  'connection.verified': 'Connection verified',
  'connection.disconnected': 'Connection disconnected',
  'connection.removed': 'API connection removed',
  'sync.queued': 'Provider sync queued',
  'sync.completed': 'Provider sync completed',
  'sync.partial': 'Provider sync partially completed',
  'sync.schedule_changed': 'Sync schedule updated',
  'csv.imported': 'Portfolio file imported',
  'sale.recorded': 'Sale agreement recorded',
  'sale.updated': 'Sale agreement updated',
  'sale.deleted': 'Sale agreement removed',
  'payment.recorded': 'Payout recorded',
  'payment.updated': 'Payout updated',
  'payment.received_date_updated': 'Payout date updated',
  'finance.adjusted': 'Financial adjustment recorded',
  'expense.recorded': 'Expense recorded',
  'note.added': 'Note added',
  'workspace.updated': 'Workspace details updated',
  'workspace.price_publishing_changed': 'Price publishing preference updated',
  'settings.provider_actions_changed': 'Provider action preferences updated',
  'team.member_updated': 'Team access updated',
  'team.member_removed': 'Team member removed',
  'team.member_left': 'Team member left',
  'team.custom_role_created': 'Team role added',
  'team.custom_role_updated': 'Team role updated',
  'team.custom_role_deleted': 'Team role removed',
};

const activityActions = [...Object.keys(labels), ...bulkActivityActions];
const marketplacePriceActions = [
  'listing.price_confirmed',
  'listing.price_verified',
  'listing.price_failed',
  'listing.price_unverified',
];
const providerChangeActions = [
  'provider.change_confirmed',
  'provider.change_verified',
  'provider.change_failed',
  'provider.change_unverified',
  'provider.nameserver_confirmation_recheck',
];
export const workspaceActivityLimit = 100;

function priceDescription(detail: unknown, currency: string | null, providerId: string | null) {
  if (!detail || typeof detail !== 'object') return null;
  const values = detail as Record<string, unknown>;
  const code = typeof values.currency === 'string' ? values.currency : currency;
  const price = (value: unknown) => {
    if (
      !code ||
      !/^[A-Z]{3}$/.test(code) ||
      (typeof value !== 'string' && typeof value !== 'number')
    )
      return null;
    const amount = Number(value);
    return Number.isFinite(amount) && String(value).trim()
      ? new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: code,
          maximumFractionDigits: 2,
        }).format(amount)
      : null;
  };
  const provider =
    providerId === 'spaceship'
      ? 'SellerHub'
      : providerId && Object.hasOwn(providers, providerId)
        ? providers[providerId as ProviderId].name
        : null;
  const previous = price(values.previousPrice);
  const requested = price(values.newPrice);
  return (
    [provider, requested ? (previous ? `${previous} → ${requested}` : requested) : null]
      .filter(Boolean)
      .join(' · ') || null
  );
}

export async function workspaceActivity(organizationId: string, take: number, userId?: string) {
  const unread = userId
    ? Prisma.sql`EXISTS (
    SELECT 1 FROM "OrganizationMember" m
    WHERE m."organizationId" = a."organizationId" AND m."userId" = ${userId}
      AND a."createdAt" >= m."joinedAt"
      AND NOT EXISTS (
        SELECT 1 FROM "WorkspaceActivityRead" r
        WHERE r."activityId" = a.id AND r."membershipId" = m.id
      )
  )`
    : Prisma.sql`FALSE`;
  const rows = await db.$queryRaw<
    {
      id: string;
      action: string;
      detail: unknown;
      createdAt: Date;
      unread: boolean;
      domainId: string | null;
      domainName: string | null;
      currency: string | null;
      providerId: string | null;
      providerAction: string | null;
    }[]
  >`
    SELECT a.id, a.action, a.detail, a."createdAt", ${unread} AS unread,
      CASE WHEN d."deletedAt" IS NULL THEN d.id END AS "domainId",
      d.name AS "domainName", COALESCE(l.currency, d.currency) AS currency,
      COALESCE(l.marketplace, p."providerId") AS "providerId", c.action AS "providerAction"
    FROM "AuditLog" a
    LEFT JOIN "DomainListing" l ON a.action IN (${Prisma.join(marketplacePriceActions)}) AND l.id = a."entityId"
    LEFT JOIN "ProviderChange" c ON a.action IN (${Prisma.join(providerChangeActions)})
      AND c.id = a."entityId" AND c."organizationId" = a."organizationId"
    LEFT JOIN "ProviderAccount" p ON p.id = c."providerAccountId" AND p."organizationId" = a."organizationId"
    LEFT JOIN "Domain" d ON d."organizationId" = a."organizationId"
      AND d.id = CASE
        WHEN a.action LIKE 'domain.%' OR a.action LIKE 'registration.%' OR a.action LIKE 'renewal.%'
          THEN a."entityId"
        ELSE COALESCE(l."domainId", c."domainId")
      END
    WHERE a."organizationId"=${organizationId}
      AND a.action IN (${Prisma.join(activityActions)})
      AND COALESCE(a.detail->>'source', '') <> 'manual-bulk'
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT ${take}
  `;
  return rows.flatMap(({ action, detail, currency, providerId, providerAction, ...row }) => {
    const batch = bulkActivity(action, detail);
    const label = batch?.label ?? labels[action];
    const description =
      batch?.preview ??
      (marketplacePriceActions.includes(action) || action === 'domain.asking_price_updated'
        ? priceDescription(detail, currency, row.domainName ? providerId : null)
        : providerAction === 'changeNameservers'
          ? 'Nameserver change'
          : providerAction === 'removeListing'
            ? 'Marketplace listing removal'
            : providerAction === 'addListing'
              ? 'Marketplace listing creation'
              : null);
    return label ? [{ ...row, label, description }] : [];
  });
}

export async function unreadWorkspaceActivityCount(organizationId: string, userId: string) {
  const preference = await db.userPreference.findUnique({
    where: { userId },
    select: { notifications: true },
  });
  if (preference?.notifications === false) return 0;
  const events = await workspaceActivity(organizationId, workspaceActivityLimit, userId);
  return events.filter((event) => event.unread).length;
}

/** Acknowledge explicit rows so events arriving after the fetch remain unread. */
export async function markWorkspaceActivityRead(
  organizationId: string,
  userId: string,
  ids: string[],
) {
  if (!ids.length) return;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const member = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, joinedAt: true },
    });
    if (!member) throw new AppError('Workspace access changed. Refresh and try again.', 403);
    await tx.$executeRaw`
      INSERT INTO "WorkspaceActivityRead" ("activityId", "membershipId")
      SELECT id, ${member.id} FROM "AuditLog"
      WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${member.joinedAt}
        AND action IN (${Prisma.join(activityActions)})
        AND COALESCE(detail->>'source', '') <> 'manual-bulk'
        AND id IN (${Prisma.join(ids)})
      ON CONFLICT DO NOTHING
    `;
  });
}
