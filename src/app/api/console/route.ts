import { bulkSafetyCap } from '@/lib/bulk-limit';
import { providerBatchInput } from '@/integrations/provider-batch';
import { providerBatchLimit } from '@/integrations/provider-batch-options';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { context, requireRole } from '@/lib/access';
import {
  AppError,
  assertOrigin,
  encrypt,
  decrypt,
  safeProviderError,
  readJson,
} from '@/lib/security';
import { queuePublicRegistration, publicRegistrationStatus } from '@/lib/public-registration-jobs';
import { dashboard } from '@/lib/dashboard';
import { financialTrends } from '@/lib/financial-trend-query';
import { parseTrendPeriod } from '@/lib/financial-trends';
import { advancedFinancialReport } from '@/lib/advanced-report';
import {
  listDomains,
  ownedDomain,
  saveDomain,
  importCsv,
  recordSale,
  deleteSale,
  recordPayment,
  reconcileEditedPayouts,
  settlePayout,
  audit,
  setRenewalEstimate,
} from '@/lib/portfolio';
import { money } from '@/lib/domain';
import {
  availableProviderIds,
  isAvailableProvider,
  providers,
  type ProviderId,
} from '@/integrations/catalog';
import { adapter, type Credentials } from '@/integrations/adapters';
import { queueSync } from '@/integrations/sync';
import { reportError } from '@/lib/telemetry';
import { throttle } from '@/lib/throttle';
import {
  previewListingPrice,
  confirmListingPrice,
  previewMarketplacePrices,
  confirmMarketplacePrices,
  maxPricePreviewBatch,
} from '@/lib/listing-prices';
import {
  previewProviderChange,
  confirmProviderChange,
  confirmProviderChanges,
  previewProviderBatch,
  providerActionPolicy,
  recheckNameserverChange,
} from '@/lib/provider-changes';
import { queueListingStats } from '@/integrations/listing-stats';
import { removeWorkspaceMember } from '@/lib/workspace-members';
import { markWorkspaceNotificationsRead } from '@/lib/workspace-notifications';
import {
  markWorkspaceActivityRead,
  unreadWorkspaceActivityCount,
  workspaceActivity,
  workspaceActivityLimit,
} from '@/lib/workspace-activity';
import { lockWorkspaceMembership, lockWritableWorkspace } from '@/lib/workspace-write';
import { bulkRegistrationDigest, bulkRegistrationSelect } from '@/lib/bulk-snapshot';
import { changeAccountPassword, deleteAccount, deleteOwnedWorkspace } from '@/lib/account-security';
export const runtime = 'nodejs';
function error(e: unknown) {
  if (!(e instanceof AppError) && !(e instanceof z.ZodError)) void reportError('api');
  const status = e instanceof AppError ? e.status : e instanceof z.ZodError ? 400 : 500;
  return Response.json(
    {
      error:
        e instanceof AppError
          ? e.message
          : e instanceof z.ZodError
            ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
            : 'The operation could not be completed. Check inputs and retry.',
    },
    { status },
  );
}
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const query = new URL(request.url).searchParams;
    const view = query.get('view');
    if (view === 'activity')
      return Response.json(
        await workspaceActivity(ctx.org.id, workspaceActivityLimit, ctx.user.id!),
        {
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    if (view === 'activityUnread')
      return Response.json(
        { count: await unreadWorkspaceActivityCount(ctx.org.id, ctx.user.id!) },
        {
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    if (view === 'publicRegistration')
      return Response.json(await publicRegistrationStatus(ctx.org.id), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    if (view === 'financialTrends')
      return Response.json(await financialTrends(ctx, parseTrendPeriod(query.get('period'))), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    if (view === 'providerActionPolicy')
      return Response.json(await providerActionPolicy(ctx), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    if (view === 'advancedReport')
      return Response.json(await advancedFinancialReport(ctx), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    if (view === 'priceChange') {
      const change = await db.listingPriceChange.findFirst({
        where: { id: query.get('id') || '', organizationId: ctx.org.id },
        select: { status: true, error: true, newPrice: true, currency: true, verifiedAt: true },
      });
      if (!change) throw new AppError('Price change not found', 404);
      return Response.json(change);
    }
    if (view === 'jobStatus') {
      const ids = z
        .array(z.string().min(1).max(64))
        .min(1)
        .max(100)
        .parse((query.get('ids') || '').split(','));
      return Response.json(
        await db.syncJob.findMany({
          where: { id: { in: ids }, account: { organizationId: ctx.org.id } },
          select: { id: true, status: true, updated: true, error: true },
        }),
      );
    }
    if (view === 'providerChange') {
      const change = await db.providerChange.findFirst({
        where: { id: query.get('id') || '', organizationId: ctx.org.id },
        select: { status: true, error: true, action: true, finishedAt: true },
      });
      if (!change) throw new AppError('Provider change not found', 404);
      return Response.json(change);
    }
    if (view === 'domains') return Response.json(await listDomains(ctx, query));
    if (view === 'domain') return Response.json(await ownedDomain(ctx, query.get('id') || ''));
    if (view === 'sync') {
      const jobs = await db.syncJob.findMany({
        where: { account: { organizationId: ctx.org.id } },
        include: {
          account: { select: { label: true, providerId: true, status: true } },
          reviews: {
            where: { membership: { organizationId: ctx.org.id, userId: ctx.user.id! } },
            select: { reviewedAt: true },
          },
          priceChange: {
            select: {
              organizationId: true,
              oldPrice: true,
              newPrice: true,
              currency: true,
              listing: {
                select: {
                  domain: {
                    select: { id: true, name: true, organizationId: true, deletedAt: true },
                  },
                },
              },
            },
          },
          providerChange: {
            select: {
              organizationId: true,
              action: true,
              domain: { select: { id: true, name: true, organizationId: true, deletedAt: true } },
            },
          },
          errors: { take: 20, orderBy: { id: 'asc' } },
          items: {
            select: { domainName: true, status: true, message: true },
            take: 100,
            orderBy: { domainName: 'asc' },
          },
          _count: { select: { items: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return Response.json(
        jobs.map(({ priceChange, providerChange, reviews, ...job }) => {
          const change = priceChange ?? providerChange;
          const domain = priceChange?.listing.domain ?? providerChange?.domain;
          const target =
            change?.organizationId === ctx.org.id && domain?.organizationId === ctx.org.id
              ? {
                  domainId: domain.deletedAt ? null : domain.id,
                  domainName: domain.name,
                  action: providerChange?.action ?? null,
                  price: priceChange
                    ? {
                        previous: priceChange.oldPrice,
                        requested: priceChange.newPrice,
                        currency: priceChange.currency,
                      }
                    : null,
                }
              : null;
          return {
            ...job,
            target,
            reviewed: reviews.some(
              ({ reviewedAt }) => !job.finishedAt || reviewedAt >= job.finishedAt,
            ),
          };
        }),
      );
    }
    if (view === 'team')
      return Response.json(
        await db.organizationMember.findMany({
          where: { organizationId: ctx.org.id },
          include: {
            customRole: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      );
    if (view === 'customRoles')
      return Response.json(
        await db.workspaceCustomRole.findMany({
          where: { organizationId: ctx.org.id },
          orderBy: { name: 'asc' },
        }),
      );
    return Response.json(await dashboard(ctx));
  } catch (e) {
    return error(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (Number(request.headers.get('content-length')) > 12_000_000)
      throw new AppError('Request too large', 413);
    const ctx = await context();
    const body = z
      .object({ action: z.string(), data: z.unknown().optional() })
      .parse(await readJson(request));
    const data = body.data;
    switch (body.action) {
      case 'registration.publicLookup':
        return Response.json(await queuePublicRegistration(ctx), { status: 202 });
      case 'registration.renewalCost':
        return Response.json(await setRenewalEstimate(ctx, data));
      case 'listing.statistics.queue':
        return Response.json(
          await queueListingStats(
            ctx,
            z.object({ domainIds: z.array(z.string()).min(1).max(bulkSafetyCap) }).parse(data)
              .domainIds,
          ),
        );
      case 'provider.batch.preview':
        return Response.json(await previewProviderBatch(ctx, providerBatchInput.parse(data).items));
      case 'provider.batch.confirm': {
        const { ids } = z
          .object({
            ids: z
              .array(z.string().min(1))
              .min(1)
              .max(providerBatchLimit)
              .refine((items) => new Set(items).size === items.length, 'Select unique previews'),
          })
          .parse(data);
        return Response.json(await confirmProviderChanges(ctx, ids));
      }
      case 'provider.change.preview':
        return Response.json(await previewProviderChange(ctx, data));
      case 'provider.nameserver.recheck':
        return Response.json(
          await recheckNameserverChange(ctx, z.object({ id: z.string().min(1) }).parse(data).id),
        );
      case 'provider.change.confirm':
        return Response.json(
          await confirmProviderChange(ctx, z.object({ id: z.string() }).parse(data).id),
        );
      case 'verification.options':
        throw new AppError('TXT editing is unavailable in Assame.', 410);
      case 'settings.providerActions': {
        requireRole(ctx, 'ADMIN');
        const input = z.object({ enabled: z.boolean() }).parse(data);
        if (ctx.org.demo || process.env.PROVIDER_WRITES_ENABLED !== 'true')
          throw new AppError('Provider writes are unavailable in this deployment', 403);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'ADMIN');
          await tx.organization.update({
            where: { id: ctx.org.id },
            data: { providerActionsEnabled: input.enabled },
          });
          await audit(tx, ctx, 'settings.provider_actions_changed', ctx.org.id, {
            enabled: input.enabled,
          });
        });
        return Response.json({ ok: true });
      }
      case 'domain.save': {
        const input = z.object({ id: z.string().optional(), values: z.unknown() }).parse(data);
        return Response.json(await saveDomain(ctx, input.values, input.id));
      }
      case 'domain.delete': {
        requireRole(ctx);
        const { id } = z.object({ id: z.string() }).parse(data);
        await db.$transaction(async (tx) => {
          await lockWorkspaceMembership(tx, ctx, 'EDITOR', 'domainDeletion');
          const domain = await tx.domain.findFirst({
            where: { id, organizationId: ctx.org.id, deletedAt: null },
            select: { id: true, name: true },
          });
          if (!domain) throw new AppError('Domain not found', 404);
          await tx.domain.update({ where: { id: domain.id }, data: { deletedAt: new Date() } });
          await audit(tx, ctx, 'domain.deleted', domain.id, { name: domain.name });
        });
        return Response.json({ ok: true });
      }
      case 'csv.preview':
        return Response.json(await importCsv(ctx, data, false));
      case 'csv.confirm':
        return Response.json(await importCsv(ctx, data, true));
      case 'sale.create':
        return Response.json(await recordSale(ctx, data));
      case 'sale.delete': {
        const { saleId } = z.object({ saleId: z.string() }).parse(data);
        return Response.json(await deleteSale(ctx, saleId));
      }
      case 'payment.create':
        return Response.json(await recordPayment(ctx, data));
      case 'payment.date': {
        requireRole(ctx);
        const input = z
          .object({ paymentId: z.string(), receivedAt: z.string().date() })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          const payment = await tx.salePayment.findFirst({
            where: { id: input.paymentId, sale: { domain: { organizationId: ctx.org.id } } },
          });
          if (!payment) throw new AppError('Payment not found', 404);
          await tx.salePayment.update({
            where: { id: payment.id },
            data: { receivedAt: new Date(input.receivedAt) },
          });
          await audit(tx, ctx, 'payment.received_date_updated', payment.saleId, {
            paymentId: payment.id,
            previousDate: payment.receivedAt?.toISOString() ?? null,
            receivedAt: input.receivedAt,
          });
        });
        return Response.json({ ok: true });
      }
      case 'payment.update': {
        requireRole(ctx);
        const input = z
          .object({
            paymentId: z.string(),
            amount: money,
            commissionWithheld: money.optional(),
            receivedAt: z.string().date().nullable().optional(),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          const reference = await tx.salePayment.findFirst({
            where: { id: input.paymentId, sale: { domain: { organizationId: ctx.org.id } } },
            select: { saleId: true },
          });
          if (!reference) throw new AppError('Payment not found', 404);
          await tx.$queryRaw`SELECT id FROM "DomainSale" WHERE id = ${reference.saleId} FOR UPDATE`;
          const payment = await tx.salePayment.findFirst({
            where: { id: input.paymentId, sale: { domain: { organizationId: ctx.org.id } } },
            include: { sale: { include: { domain: true, commissions: true } } },
          });
          if (!payment) throw new AppError('Payment not found', 404);
          const allPayments = await tx.salePayment.findMany({
            where: { saleId: payment.saleId },
            orderBy: { id: 'asc' },
          });
          const commission = payment.sale.commissions.reduce(
            (sum, item) => sum.plus(item.amount),
            new Decimal(0),
          );
          let totalSettled: Decimal;
          if (input.commissionWithheld !== undefined) {
            const others = allPayments.filter((item) => item.id !== payment.id);
            totalSettled = settlePayout(
              payment.sale.grossAmount,
              commission,
              others.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)),
              others.reduce((sum, item) => sum.plus(item.commissionWithheld), new Decimal(0)),
              input,
            ).settled;
          } else if (!payment.amount.eq(input.amount)) {
            totalSettled = await reconcileEditedPayouts(
              tx,
              payment.sale.grossAmount,
              commission,
              allPayments.map((item) =>
                item.id === payment.id ? { ...item, amount: input.amount } : item,
              ),
            );
          } else {
            totalSettled = allPayments.reduce(
              (sum, item) => sum.plus(item.amount).plus(item.commissionWithheld),
              new Decimal(0),
            );
          }
          const isComplete = totalSettled.gte(payment.sale.grossAmount);
          await tx.salePayment.update({
            where: { id: payment.id },
            data: {
              amount: input.amount,
              ...(input.commissionWithheld !== undefined && {
                commissionWithheld: input.commissionWithheld,
              }),
              ...(input.receivedAt !== undefined && {
                receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
              }),
            },
          });
          await tx.domainSale.update({
            where: { id: payment.saleId },
            data: { status: isComplete ? 'completed' : 'paying' },
          });

          await audit(tx, ctx, 'payment.updated', payment.saleId, {
            paymentId: payment.id,
            previousAmount: payment.amount.toString(),
            newAmount: input.amount,
          });
        });
        return Response.json({ ok: true });
      }
      case 'sale.update': {
        requireRole(ctx);
        const input = z
          .object({
            saleId: z.string(),
            grossAmount: money.optional(),
            marketplace: z.string().min(1).max(80).optional(),
            commission: money.optional(),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          await tx.$queryRaw`SELECT s.id FROM "DomainSale" s JOIN "Domain" d ON d.id = s."domainId" WHERE s.id = ${input.saleId} AND d."organizationId" = ${ctx.org.id} FOR UPDATE OF s`;
          const sale = await tx.domainSale.findFirst({
            where: { id: input.saleId, domain: { organizationId: ctx.org.id } },
            include: { domain: true, commissions: true },
          });
          if (!sale) throw new AppError('Sale not found', 404);
          let status: string | undefined;
          const previousCommission = sale.commissions.reduce(
            (sum, item) => sum.plus(item.amount),
            new Decimal(0),
          );
          const gross = new Decimal(input.grossAmount ?? sale.grossAmount);
          const commission = new Decimal(input.commission ?? previousCommission);
          if (input.grossAmount !== undefined || input.commission !== undefined) {
            if (commission.gt(gross)) throw new AppError('Commission exceeds sale amount');
            const payments = await tx.salePayment.findMany({
              where: { saleId: sale.id },
              orderBy: { id: 'asc' },
            });
            if (payments.length && ['signed', 'paying', 'completed'].includes(sale.status)) {
              const settled = await reconcileEditedPayouts(tx, gross, commission, payments);
              status = settled.eq(gross) ? 'completed' : 'paying';
            }
          }
          if (input.grossAmount || input.marketplace || status) {
            await tx.domainSale.update({
              where: { id: sale.id },
              data: {
                ...(input.grossAmount && { grossAmount: input.grossAmount }),
                ...(input.marketplace && { marketplace: input.marketplace }),
                ...(status && { status }),
              },
            });
          }

          if (input.commission !== undefined && !commission.eq(previousCommission)) {
            await tx.commission.deleteMany({ where: { saleId: sale.id } });
            await tx.commission.create({
              data: { saleId: sale.id, amount: input.commission, currency: sale.currency },
            });
          }

          await audit(tx, ctx, 'sale.updated', sale.id, {
            previousGross: sale.grossAmount.toString(),
            newGross: input.grossAmount,
          });
        });
        return Response.json({ ok: true });
      }
      case 'domain.asking_price': {
        requireRole(ctx);
        const input = z
          .object({
            domainId: z.string(),
            askingPrice: money.nullable(),
            syncMarketplaces: z.boolean().default(false),
          })
          .parse(data);
        if (input.syncMarketplaces)
          throw new AppError(
            'Marketplace prices require individual provider previews and confirmation.',
            409,
          );

        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx);
          const domain = await tx.domain.findFirst({
            where: { id: input.domainId, organizationId: ctx.org.id, deletedAt: null },
          });
          if (!domain) throw new AppError('Domain not found', 404);
          await tx.domain.update({
            where: { id: domain.id },
            data: { askingPrice: input.askingPrice },
          });
          await tx.domainPriceHistory.create({
            data: {
              domainId: domain.id,
              marketplace: 'Internal asking price',
              previousPrice: domain.askingPrice,
              price: input.askingPrice,
              currency: domain.currency,
              source: 'manual',
            },
          });
          await audit(tx, ctx, 'domain.asking_price_updated', domain.id, {
            previousPrice: domain.askingPrice?.toString() ?? null,
            newPrice: input.askingPrice,
            syncMarketplaces: input.syncMarketplaces,
          });
        });

        return Response.json({ ok: true, askingPrice: input.askingPrice });
      }
      case 'adjustment.create': {
        requireRole(ctx);
        const input = z
          .object({
            saleId: z.string(),
            amount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/),
            reason: z.string().max(300).optional().default('Adjustment'),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          const sale = await tx.domainSale.findFirst({
            where: { id: input.saleId, domain: { organizationId: ctx.org.id } },
          });
          if (!sale) throw new AppError('Sale not found', 404);
          await tx.financialAdjustment.create({
            data: {
              saleId: input.saleId,
              amount: input.amount,
              reason: input.reason || 'Adjustment',
              currency: sale.currency,
            },
          });
          await audit(tx, ctx, 'finance.adjusted', sale.id, {
            amount: input.amount,
          });
        });
        return Response.json({ ok: true });
      }
      case 'note.create': {
        requireRole(ctx);
        const input = z
          .object({ domainId: z.string(), body: z.string().trim().min(1).max(5000) })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx);
          const domain = await tx.domain.findFirst({
            where: { id: input.domainId, organizationId: ctx.org.id, deletedAt: null },
            select: { id: true },
          });
          if (!domain) throw new AppError('Domain not found', 404);
          await tx.domainNote.create({ data: { ...input, authorId: ctx.user.id! } });
          await audit(tx, ctx, 'note.added', input.domainId);
        });
        return Response.json({ ok: true });
      }
      case 'expense.create': {
        requireRole(ctx);
        const input = z
          .object({ domainId: z.string(), amount: money, category: z.string().min(1).max(100) })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          const domain = await tx.domain.findFirst({
            where: { id: input.domainId, organizationId: ctx.org.id, deletedAt: null },
          });
          if (!domain) throw new AppError('Domain not found', 404);
          await tx.domainExpense.create({ data: { ...input, currency: domain.currency } });
          await audit(tx, ctx, 'expense.recorded', domain.id, { amount: input.amount });
        });
        return Response.json({ ok: true });
      }
      case 'renewal.confirm': {
        requireRole(ctx);
        const input = z
          .object({ registrationId: z.string(), expiresAt: z.string().date(), amount: money })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
          const reg = await tx.domainRegistration.findFirst({
            where: {
              id: input.registrationId,
              domain: { organizationId: ctx.org.id, deletedAt: null },
            },
          });
          if (!reg) throw new AppError('Registration not found', 404);
          if (reg.expiresAt && new Date(input.expiresAt) <= reg.expiresAt)
            throw new AppError('New expiration must be later than current expiration');
          await tx.domainRegistration.update({
            where: { id: reg.id },
            data: {
              expiresAt: new Date(input.expiresAt),
              source: 'manual-renewal',
              verifiedAt: null,
            },
          });
          await tx.domainRenewal.create({
            data: {
              domainId: reg.domainId,
              amount: input.amount,
              currency: reg.currency,
              expiresAt: new Date(input.expiresAt),
            },
          });
          await tx.domainExpense.create({
            data: {
              domainId: reg.domainId,
              amount: input.amount,
              currency: reg.currency,
              category: 'renewal',
            },
          });
          await audit(tx, ctx, 'renewal.manually_confirmed', reg.domainId);
        });
        return Response.json({ ok: true });
      }
      case 'registration.nameservers': {
        requireRole(ctx);
        const input = z
          .object({
            registrationId: z.string(),
            nameservers: z
              .array(
                z
                  .string()
                  .trim()
                  .toLowerCase()
                  .regex(/^[a-z0-9][a-z0-9-._]{1,253}[a-z0-9]$/, 'Invalid nameserver hostname'),
              )
              .min(1)
              .max(13),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx);
          const reg = await tx.domainRegistration.findFirst({
            where: {
              id: input.registrationId,
              domain: { organizationId: ctx.org.id, deletedAt: null },
            },
            include: { domain: { select: { name: true } } },
          });
          if (!reg) throw new AppError('Registration not found', 404);
          await tx.domainRegistration.update({
            where: { id: reg.id },
            data: {
              nameservers: input.nameservers,
              source: 'manual-nameservers',
              verifiedAt: null,
            },
          });
          await audit(tx, ctx, 'registration.nameservers_recorded', reg.domainId, {
            domain: reg.domain.name,
            previous: reg.nameservers,
            nameservers: input.nameservers,
            registrar: reg.registrar,
          });
        });
        return Response.json({ ok: true, nameservers: input.nameservers, scope: 'portfolio' });
      }
      case 'verification.status': {
        requireRole(ctx);
        const { domainId } = z.object({ domainId: z.string() }).parse(data);
        const domain = await db.domain.findFirst({
          where: { id: domainId, organizationId: ctx.org.id, deletedAt: null },
          include: {
            listings: { include: { account: { include: { credential: true } } } },
            registrations: true,
          },
        });
        if (!domain) throw new AppError('Domain not found', 404);

        const results = [];
        for (const l of domain.listings) {
          const prov = l.marketplace;
          let needsVerification = false;
          let message = 'Active on marketplace';
          let method = 'unknown';
          let recommendedValue: string | null = null;

          if (prov === 'afternic') {
            if (['PENDING', 'pending', 'unverified', 'review', 'REJECTED'].includes(l.status)) {
              needsVerification = true;
              message = 'Afternic listing is PENDING review or ownership verification';
              method = 'provider-dashboard';
              recommendedValue =
                'Review the supported ownership-verification methods in your Afternic dashboard';
            }
          } else if (prov === 'spaceship') {
            if (['unverified', 'requires_verification', 'draft', 'pending'].includes(l.status)) {
              needsVerification = true;
              message = 'SellerHub listing requires ownership verification';
              method = 'provider-dashboard';
            }
          } else if (prov === 'atom') {
            if (
              ['Pending Approval', 'Pending Verification', 'unverified', 'Draft'].includes(l.status)
            ) {
              needsVerification = true;
              message = 'Atom listing is awaiting ownership verification';
              method = 'provider-dashboard';
              recommendedValue =
                'Review the supported ownership-verification methods in your Atom dashboard';
            }
          } else if (prov === 'dynadot') {
            const isDynadotReg = domain.registrations.some(
              (r) => r.registrar.toLowerCase() === 'dynadot',
            );
            if (isDynadotReg) {
              message =
                'Ensure domain is UNLOCKED in Dynadot (My Domains > Manage Domains > Unlock Domains) for marketplace sales';
              method = 'unlock';
            }
          }

          results.push({
            marketplace: prov,
            status: l.status,
            needsVerification,
            message,
            method,
            recommendedValue,
            verifiedAt: l.verifiedAt,
          });
        }

        return Response.json({ domain: domain.name, verification: results });
      }
      case 'connection.save': {
        requireRole(ctx, 'ADMIN');
        if (ctx.org.demo)
          throw new AppError('Switch to a real workspace before connecting a live account', 409);
        const input = z
          .object({
            provider: z.enum([
              'afternic',
              'spaceship',
              'dynadot',
              'atom',
              'namecheap',
              'atomRegistrar',
              'sedo',
              'godaddy',
            ]),
            label: z.string().trim().min(1).max(80),
            apiKey: z.string().min(1).max(512),
            apiSecret: z.string().max(512).optional(),
            apiUser: z.string().trim().min(1).max(25).optional(),
            accountPassword: z.string().min(1).max(16).optional(),
            clientIp: z.ipv4().optional(),
            userId: z
              .string()
              .regex(/^\d{1,20}$/)
              .optional(),
          })
          .parse(data);
        if (!providers[input.provider].available) throw new AppError('Provider unavailable', 409);
        if (input.provider === 'sedo') {
          if (
            !/^\d{1,20}$/.test(input.apiKey) ||
            !input.apiSecret ||
            !input.apiUser ||
            !input.accountPassword
          )
            throw new AppError(
              'Sedo requires a numeric Partner ID, sign key, username and password.',
            );
        } else if (input.apiKey.length < 3) {
          throw new AppError('The API key must contain at least three characters.');
        }
        if (['afternic', 'spaceship'].includes(input.provider) && !input.apiSecret)
          throw new AppError('API secret is required');
        if (input.provider === 'atom' && !input.userId)
          throw new AppError('Atom seller user ID is required');
        let resolvedIp = input.clientIp;
        if (input.provider === 'namecheap' && !resolvedIp) {
          try {
            resolvedIp = (
              await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) }).then(
                (r) => r.text(),
              )
            ).trim();
          } catch {
            // fallback
          }
        }
        if (
          input.provider === 'namecheap' &&
          (!input.apiUser || input.apiUser.length > 20 || !resolvedIp || input.apiKey.length > 50)
        )
          throw new AppError(
            'Namecheap requires an account username, API key (up to 50 characters) and allowlisted IPv4 address',
          );
        const ciphertext = encrypt({
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          userId: input.userId,
          apiUser: input.apiUser,
          clientIp: resolvedIp,
          accountPassword: input.provider === 'sedo' ? input.accountPassword : undefined,
        });
        const account = await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'ADMIN');
          await tx.provider.upsert({
            where: { id: input.provider },
            create: {
              id: input.provider,
              name: providers[input.provider].name,
              kind: providers[input.provider].kind,
            },
            update: {},
          });
          const account = await tx.providerAccount.upsert({
            where: {
              organizationId_providerId_label: {
                organizationId: ctx.org.id,
                providerId: input.provider,
                label: input.label,
              },
            },
            create: {
              organizationId: ctx.org.id,
              providerId: input.provider,
              label: input.label,
              credential: { create: { ciphertext } },
            },
            update: {
              status: 'unverified',
              credential: { upsert: { create: { ciphertext }, update: { ciphertext } } },
            },
          });
          await audit(tx, ctx, 'credentials.saved', account.id);
          return { id: account.id };
        });
        return Response.json(account);
      }
      case 'connection.test': {
        requireRole(ctx, 'ADMIN');
        const input = z.object({ accountId: z.string() }).parse(data);
        await throttle(`connection-test:${ctx.org.id}:${input.accountId}`);
        const account = await db.providerAccount.findFirst({
          where: { id: input.accountId, organizationId: ctx.org.id },
          include: { credential: true },
        });
        if (!account?.credential) throw new AppError('Credentials unavailable', 404);
        if (!isAvailableProvider(account.providerId))
          throw new AppError('Provider unavailable', 409);
        const credentialCiphertext = account.credential.ciphertext;
        const markStatus = (status: 'connected' | 'error') =>
          db.$transaction(async (tx) => {
            await lockWritableWorkspace(tx, ctx, 'ADMIN');
            const current = await tx.providerAccount.findFirst({
              where: { id: account.id, organizationId: ctx.org.id },
              include: { credential: true },
            });
            if (!current?.credential || current.credential.ciphertext !== credentialCiphertext)
              throw new AppError('Credentials changed during verification. Test again.', 409);
            await tx.providerAccount.update({ where: { id: account.id }, data: { status } });
            if (status === 'connected') await audit(tx, ctx, 'connection.verified', account.id);
          });
        try {
          await adapter(
            account.providerId as ProviderId,
            decrypt<Credentials>(account.credential.ciphertext),
          ).test();
        } catch (e) {
          await markStatus('error');
          throw new AppError(safeProviderError(e), 502);
        }
        await markStatus('connected');
        return Response.json({ ok: true, message: 'Remote API confirmed read access' });
      }
      case 'job.review': {
        const { jobId, finishedAt } = z
          .object({
            jobId: z.string().min(1).max(128),
            finishedAt: z.iso.datetime().nullable(),
          })
          .parse(data);
        const reviewed = await db.$executeRaw`
          INSERT INTO "ProviderJobReview" ("jobId", "membershipId")
          SELECT job.id, member.id
          FROM "SyncJob" job
          JOIN "ProviderAccount" account ON account.id = job."providerAccountId"
          JOIN "OrganizationMember" member ON member."organizationId" = account."organizationId"
          WHERE job.id = ${jobId} AND account."organizationId" = ${ctx.org.id}
            AND member."userId" = ${ctx.user.id!}
            AND (job.status IN ('failed', 'partial', 'unverified') OR job.kind IN ('delist', 'nameservers'))
            AND job."finishedAt" IS NOT DISTINCT FROM ${finishedAt}::timestamp
          ON CONFLICT ("jobId", "membershipId") DO UPDATE SET "reviewedAt" = CURRENT_TIMESTAMP
        `;
        if (!reviewed)
          throw new AppError('This job result changed. Open the latest details to review it.', 409);
        return Response.json({ ok: true });
      }
      case 'connection.remove':
      case 'connection.disconnect': {
        const remove = body.action === 'connection.remove';
        requireRole(ctx, 'ADMIN');
        const input = z.object({ accountId: z.string() }).parse(data);
        await db.$transaction(async (tx) => {
          await lockWorkspaceMembership(tx, ctx, 'ADMIN');
          const account = await tx.providerAccount.findFirst({
            where: { id: input.accountId, organizationId: ctx.org.id },
          });
          if (!account) throw new AppError('Account not found', 404);
          await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id = ${account.id} FOR UPDATE`;
          await tx.encryptedCredential.deleteMany({ where: { providerAccountId: account.id } });
          await tx.providerAccount.update({
            where: { id: account.id },
            data: {
              status: remove || account.status === 'removed' ? 'removed' : 'disconnected',
              syncEveryHours: 0,
            },
          });
          await audit(
            tx,
            ctx,
            remove ? 'connection.removed' : 'connection.disconnected',
            account.id,
          );
        });
        return Response.json({ ok: true });
      }
      case 'sync.queue': {
        const input = z.object({ accountId: z.string().optional() }).parse(data);
        const accounts = input.accountId
          ? [input.accountId]
          : (
              await db.providerAccount.findMany({
                where: {
                  organizationId: ctx.org.id,
                  credential: { isNot: null },
                  providerId: { in: availableProviderIds },
                },
                select: { id: true },
              })
            ).map((a) => a.id);
        const jobs = [];
        for (const id of accounts) jobs.push(await queueSync(ctx, id));
        return Response.json({ queued: jobs.length });
      }
      case 'sync.schedule': {
        requireRole(ctx, 'ADMIN');
        const input = z
          .object({ accountId: z.string(), hours: z.number().int().min(0).max(168) })
          .parse(data);
        await db.$transaction(async (tx) => {
          if (input.hours !== 0) {
            await lockWritableWorkspace(tx, ctx, 'ADMIN', false, 'sync');
          } else await lockWorkspaceMembership(tx, ctx, 'ADMIN');
          const changed = await tx.providerAccount.updateMany({
            where: {
              id: input.accountId,
              organizationId: ctx.org.id,
              ...(input.hours ? { providerId: { in: availableProviderIds } } : {}),
            },
            data: { syncEveryHours: input.hours },
          });
          if (!changed.count) throw new AppError('Account not found', 404);
          await audit(tx, ctx, 'sync.schedule_changed', input.accountId, { hours: input.hours });
        });
        return Response.json({ ok: true });
      }
      case 'bulk.delete': {
        requireRole(ctx);
        const { ids } = z
          .object({ ids: z.array(z.string()).min(1).max(bulkSafetyCap) })
          .parse(data);
        const count = await db.$transaction(async (tx) => {
          await lockWorkspaceMembership(tx, ctx, 'EDITOR', 'domainDeletion');
          const rows = await tx.domain.findMany({
            where: { id: { in: ids }, organizationId: ctx.org.id, deletedAt: null },
            select: { id: true, name: true },
          });
          if (!rows.length) throw new AppError('No matching domains found', 404);
          await tx.domain.updateMany({
            where: {
              id: { in: rows.map((r) => r.id) },
              organizationId: ctx.org.id,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
          for (const row of rows)
            await audit(tx, ctx, 'domain.deleted', row.id, {
              name: row.name,
              source: 'manual-bulk',
            });
          await audit(tx, ctx, 'bulk.deleted', undefined, {
            count: rows.length,
            domains: rows.slice(0, 3).map((row) => row.name),
          });
          return rows.length;
        });
        return Response.json({ deleted: count });
      }
      case 'bulk.preview': {
        requireRole(ctx);
        const input = z
          .object({
            ids: z.array(z.string()).min(1).max(bulkSafetyCap),
            askingPrice: money.optional(),
            price: money.optional(),
            value: z.string().optional(),
            field: z
              .enum([
                'askingPrice',
                'acquisitionCost',
                'renewalCost',
                'registrar',
                'status',
                'nameservers',
              ])
              .default('askingPrice'),
            syncMarketplaces: z.boolean().optional(),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx);
        });
        if (input.syncMarketplaces)
          throw new AppError(
            'Marketplace prices require individual provider previews and confirmation.',
            409,
          );
        const rawVal = input.value ?? input.price ?? input.askingPrice;
        if (!rawVal) throw new AppError('A value is required');
        const targetValue = rawVal.trim();
        if (['askingPrice', 'acquisitionCost', 'renewalCost'].includes(input.field)) {
          money.parse(targetValue);
        } else if (input.field === 'registrar') {
          z.string().min(1).max(100).parse(targetValue);
        } else if (input.field === 'status') {
          z.enum(['active', 'sold', 'expired', 'pending', 'in_escrow', 'lto']).parse(targetValue);
        } else if (input.field === 'nameservers') {
          const list = targetValue
            .split(/[\r\n,]+/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          if (!list.length) throw new AppError('At least one nameserver is required');
          if (list.length > 13) throw new AppError('At most 13 nameservers are supported');
          for (const ns of list) {
            if (!/^[a-z0-9][a-z0-9-._]{1,253}[a-z0-9]$/.test(ns))
              throw new AppError(`Invalid nameserver hostname: ${ns}`);
          }
        }
        const rows = await db.domain.findMany({
          where: { id: { in: input.ids }, organizationId: ctx.org.id, deletedAt: null },
          select: {
            id: true,
            name: true,
            status: true,
            askingPrice: true,
            acquisitionCost: true,
            currency: true,
            updatedAt: true,
            registrations: {
              select: bulkRegistrationSelect,
              orderBy: { id: 'asc' },
            },
          },
        });
        if (rows.length !== new Set(input.ids).size)
          throw new AppError('Selection contains unavailable domains', 403);
        const serializedRows = rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          askingPrice: r.askingPrice ? r.askingPrice.toString() : null,
          acquisitionCost: r.acquisitionCost.toString(),
          currency: r.currency,
          updatedAt: r.updatedAt.toISOString(),
          registrationDigest: bulkRegistrationDigest(r.registrations),
          registrar: r.registrations[0]?.registrar ?? 'Unknown',
          renewalCost: r.registrations[0]?.renewalCost
            ? r.registrations[0].renewalCost.toString()
            : null,
          nameservers: r.registrations[0]?.nameservers?.join(', ') || '—',
        }));
        const payload = Buffer.from(
          JSON.stringify({
            org: ctx.org.id,
            actor: ctx.user.id,
            rows: serializedRows,
            price: targetValue,
            value: targetValue,
            field: input.field,
            syncMarketplaces: input.syncMarketplaces,
            expires: Date.now() + 300000,
          }),
        ).toString('base64url');
        const signature = createHmac('sha256', process.env.AUTH_SECRET!)
          .update(payload)
          .digest('hex');
        return Response.json({
          rows: serializedRows,
          price: targetValue,
          value: targetValue,
          field: input.field,
          syncMarketplaces: input.syncMarketplaces,
          token: `${payload}.${signature}`,
        });
      }
      case 'bulk.confirm': {
        requireRole(ctx);
        const { token } = z.object({ token: z.string().max(512000) }).parse(data);
        const [payload, signature] = token.split('.');
        const expected = createHmac('sha256', process.env.AUTH_SECRET!)
          .update(payload)
          .digest('hex');
        if (
          !signature ||
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
          throw new AppError('Invalid preview');
        const input = z
          .object({
            org: z.string(),
            actor: z.string(),
            field: z
              .enum([
                'askingPrice',
                'acquisitionCost',
                'renewalCost',
                'registrar',
                'status',
                'nameservers',
              ])
              .default('askingPrice'),
            rows: z
              .array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  status: z.string().optional(),
                  askingPrice: z.string().nullable().optional(),
                  acquisitionCost: z.string().optional(),
                  currency: z.string().optional(),
                  updatedAt: z.string(),
                  registrationDigest: z
                    .string()
                    .regex(/^[a-f0-9]{64}$/)
                    .optional(),
                  registrar: z.string().optional(),
                  renewalCost: z.string().nullable().optional(),
                  nameservers: z.string().optional(),
                }),
              )
              .min(1)
              .max(bulkSafetyCap),
            price: z.string().optional(),
            value: z.string().optional(),
            syncMarketplaces: z.boolean().optional(),
            expires: z.number(),
          })
          .parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
        if (input.org !== ctx.org.id || input.actor !== ctx.user.id || input.expires < Date.now())
          throw new AppError('Preview expired or invalid');
        if (input.syncMarketplaces)
          throw new AppError(
            'Marketplace prices require individual provider previews and confirmation.',
            409,
          );
        const targetValue = (input.value ?? input.price)!.trim();
        await db.$transaction(
          async (tx) => {
            await lockWritableWorkspace(tx, ctx);
            const registrationChange = ['registrar', 'renewalCost', 'nameservers'].includes(
              input.field,
            );
            const currentRows = await tx.domain.findMany({
              where: {
                id: { in: input.rows.map((row) => row.id) },
                organizationId: ctx.org.id,
                deletedAt: null,
              },
              select: {
                id: true,
                updatedAt: true,
                registrations: { select: bulkRegistrationSelect },
              },
            });
            const currentById = new Map(currentRows.map((row) => [row.id, row]));
            if (
              currentRows.length !== input.rows.length ||
              input.rows.some((row) => {
                const current = currentById.get(row.id);
                return (
                  !current ||
                  current.updatedAt.toISOString() !== row.updatedAt ||
                  (registrationChange &&
                    (!row.registrationDigest ||
                      bulkRegistrationDigest(current.registrations) !== row.registrationDigest))
                );
              })
            )
              throw new AppError('Portfolio changed; generate a new preview', 409);
            for (const row of input.rows) {
              if (
                input.field === 'askingPrice' ||
                input.field === 'acquisitionCost' ||
                input.field === 'status'
              ) {
                const update = await tx.domain.updateMany({
                  where: {
                    id: row.id,
                    organizationId: ctx.org.id,
                    deletedAt: null,
                    updatedAt: new Date(row.updatedAt),
                  },
                  data: { [input.field]: targetValue },
                });
                if (!update.count)
                  throw new AppError('Portfolio changed; generate a new preview', 409);
                if (input.field === 'askingPrice') {
                  await tx.domainPriceHistory.create({
                    data: {
                      domainId: row.id,
                      marketplace: 'Internal asking price',
                      previousPrice: row.askingPrice,
                      price: targetValue,
                      currency: row.currency || 'USD',
                      source: 'manual-bulk',
                    },
                  });
                }
                if (input.field === 'acquisitionCost')
                  await audit(tx, ctx, 'domain.acquisition_cost_updated', row.id, {
                    previousCost: row.acquisitionCost,
                    newCost: targetValue,
                    currency: row.currency,
                    source: 'manual-bulk',
                  });
                if (input.field === 'status')
                  await audit(tx, ctx, 'domain.status_updated', row.id, {
                    previousStatus: row.status,
                    newStatus: targetValue,
                    source: 'manual-bulk',
                  });
              } else if (input.field === 'renewalCost') {
                await tx.domainRegistration.updateMany({
                  where: { domainId: row.id, domain: { organizationId: ctx.org.id } },
                  data: { renewalCost: targetValue },
                });
                await tx.domain.update({
                  where: { id: row.id },
                  data: { updatedAt: new Date() },
                });
                await audit(tx, ctx, 'domain.renewal_cost_updated', row.id, {
                  previousRenewalCost: row.renewalCost,
                  newRenewalCost: targetValue,
                  source: 'manual-bulk',
                });
              } else if (input.field === 'registrar') {
                await tx.domainRegistration.deleteMany({
                  where: {
                    domainId: row.id,
                    registrar: { not: targetValue },
                    OR: [
                      { registrar: 'Unknown' },
                      { registrar: 'Unassigned' },
                      { providerAccountId: null },
                    ],
                  },
                });
                await tx.domainRegistration.upsert({
                  where: { domainId_registrar: { domainId: row.id, registrar: targetValue } },
                  create: { domainId: row.id, registrar: targetValue, source: 'manual' },
                  update: { source: 'manual' },
                });
                await tx.domain.update({
                  where: { id: row.id },
                  data: { updatedAt: new Date() },
                });
                await audit(tx, ctx, 'domain.registrar_updated', row.id, {
                  previousRegistrar: row.registrar,
                  newRegistrar: targetValue,
                  source: 'manual-bulk',
                });
              } else if (input.field === 'nameservers') {
                const nsList = targetValue
                  .split(/[\r\n,]+/)
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean);
                const updated = await tx.domainRegistration.updateMany({
                  where: { domainId: row.id, domain: { organizationId: ctx.org.id } },
                  data: { nameservers: nsList, source: 'manual-nameservers', verifiedAt: null },
                });
                if (!updated.count)
                  throw new AppError('Add a registration before recording nameservers.', 409);
                await tx.domain.update({
                  where: { id: row.id },
                  data: { updatedAt: new Date() },
                });
                await audit(tx, ctx, 'domain.nameservers_updated', row.id, {
                  previousNameservers: row.nameservers,
                  newNameservers: nsList,
                  source: 'manual-bulk',
                });
              }
            }
            await audit(tx, ctx, `bulk.${input.field}_updated`, undefined, {
              count: input.rows.length,
              domains: input.rows.slice(0, 3).map((row) => row.name),
              value: targetValue,
            });
          },
          { timeout: 60000 },
        );
        return Response.json({ updated: input.rows.length });
      }
      case 'listing.price.preview': {
        const input = z.object({ listingId: z.string(), newPrice: money }).parse(data);
        return Response.json(await previewListingPrice(ctx, input.listingId, input.newPrice));
      }
      case 'listing.price.confirm': {
        const input = z.object({ previewId: z.string() }).parse(data);
        return Response.json(await confirmListingPrice(ctx, input.previewId));
      }
      case 'listing.price.preview_all': {
        const input = z.object({ listingId: z.string(), newPrice: money }).parse(data);
        return Response.json(await previewMarketplacePrices(ctx, input.listingId, input.newPrice));
      }
      case 'listing.price.confirm_all': {
        const input = z
          .object({ previewIds: z.array(z.string().min(1)).min(1).max(maxPricePreviewBatch) })
          .parse(data);
        return Response.json(await confirmMarketplacePrices(ctx, input.previewIds));
      }
      case 'listing.delist':
      case 'listing.bulk_delist': {
        requireRole(ctx);
        throw new AppError(
          'Marketplace delisting is unavailable. No listing was changed; manage delisting at the provider.',
          409,
        );
      }
      case 'settings.pricePublishing': {
        requireRole(ctx, 'ADMIN');
        const input = z.object({ enabled: z.boolean() }).parse(data);
        if (input.enabled && (process.env.PROVIDER_WRITES_ENABLED !== 'true' || ctx.org.demo))
          throw new AppError(
            'Provider price publishing is unavailable for this deployment or demo workspace',
            403,
          );
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'ADMIN');
          await tx.organization.update({
            where: { id: ctx.org.id },
            data: { pricePublishingEnabled: input.enabled },
          });
          await audit(tx, ctx, 'workspace.price_publishing_changed', undefined, {
            enabled: input.enabled,
          });
        });
        return Response.json({ ok: true });
      }
      case 'workspace.switch': {
        const { id } = z.object({ id: z.string() }).parse(data);
        if (!ctx.members.some((m) => m.organizationId === id))
          throw new AppError('Workspace not found', 403);
        (await cookies()).set('workspace', id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        });
        return Response.json({ ok: true });
      }
      case 'workspace.create': {
        const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(data);
        const org = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.user.id!} FOR UPDATE`;
          return tx.organization.create({
            data: {
              name,
              workspaceOwnerId: ctx.user.id!,
              members: { create: { userId: ctx.user.id!, role: 'OWNER' } },
            },
          });
        });
        return Response.json({ id: org.id });
      }
      case 'settings.save': {
        requireRole(ctx, 'ADMIN');
        const input = z
          .object({
            name: z.string().trim().min(1).max(100),
            currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
          })
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'ADMIN');
          await tx.organization.update({ where: { id: ctx.org.id }, data: input });
          await audit(tx, ctx, 'workspace.updated');
        });
        return Response.json({ ok: true });
      }
      case 'team.customRole.create': {
        requireRole(ctx, 'OWNER');
        const input = z
          .object({
            name: z.string().trim().min(2).max(60),
            baseRole: z.enum(['VIEWER', 'EDITOR', 'ADMIN']),
            allowProviderWrites: z.boolean(),
            allowDomainDeletion: z.boolean().default(true),
            allowFinanceRecords: z.boolean().default(true),
            allowSync: z.boolean().default(true),
          })
          .strict()
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'OWNER');
          if (input.baseRole === 'VIEWER' && input.allowProviderWrites)
            throw new AppError('Viewer roles cannot publish provider changes.', 400);
          const role = await tx.workspaceCustomRole.create({
            data: { organizationId: ctx.org.id, ...input },
          });
          await audit(tx, ctx, 'team.custom_role_created', role.id, {
            baseRole: role.baseRole,
            allowProviderWrites: role.allowProviderWrites,
            allowDomainDeletion: role.allowDomainDeletion,
            allowFinanceRecords: role.allowFinanceRecords,
            allowSync: role.allowSync,
          });
        });
        return Response.json({ ok: true });
      }
      case 'team.customRole.delete': {
        requireRole(ctx, 'OWNER');
        const input = z
          .object({ id: z.string().min(1).max(128) })
          .strict()
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'OWNER');
          const role = await tx.workspaceCustomRole.findFirst({
            where: { id: input.id, organizationId: ctx.org.id },
            include: { _count: { select: { members: true } } },
          });
          if (!role) throw new AppError('Custom role not found.', 404);
          if (role._count.members)
            throw new AppError('Reassign members before deleting this role.', 409);
          await tx.workspaceCustomRole.delete({ where: { id: role.id } });
          await audit(tx, ctx, 'team.custom_role_deleted', role.id);
        });
        return Response.json({ ok: true });
      }
      case 'team.customRole.update': {
        requireRole(ctx, 'OWNER');
        const details = z
          .object({
            name: z.string().trim().min(2).max(60),
            allowProviderWrites: z.boolean(),
            allowDomainDeletion: z.boolean(),
            allowFinanceRecords: z.boolean(),
            allowSync: z.boolean(),
          })
          .strict();
        const input = z
          .object({
            id: z.string().min(1).max(128),
            expected: details,
            next: details,
          })
          .strict()
          .parse(data);
        await db.$transaction(async (tx) => {
          await lockWritableWorkspace(tx, ctx, 'OWNER');
          const role = await tx.workspaceCustomRole.findFirst({
            where: { id: input.id, organizationId: ctx.org.id },
          });
          if (!role) throw new AppError('Custom role not found.', 404);
          if (role.baseRole === 'VIEWER' && input.next.allowProviderWrites)
            throw new AppError('Viewer roles cannot publish provider changes.', 400);
          if (
            Object.entries(input.expected).some(
              ([key, value]) => role[key as keyof typeof role] !== value,
            )
          )
            throw new AppError('This role changed. Refresh and try again.', 409);
          await tx.workspaceCustomRole.update({ where: { id: role.id }, data: input.next });
          await audit(tx, ctx, 'team.custom_role_updated', role.id, {
            previous: input.expected,
            next: input.next,
          });
        });
        return Response.json({ ok: true });
      }
      case 'team.remove': {
        const input = z
          .object({ membershipId: z.string().min(1).max(128) })
          .strict()
          .parse(data);
        await removeWorkspaceMember(ctx.user.id!, ctx.org.id, input.membershipId, 'remove');
        return Response.json({ ok: true });
      }
      case 'team.leave': {
        const membership = ctx.members.find((member) => member.organizationId === ctx.org.id);
        if (!membership) throw new AppError('Workspace unavailable', 403);
        await removeWorkspaceMember(ctx.user.id!, ctx.org.id, membership.id, 'leave');
        return Response.json({ ok: true });
      }
      case 'team.save': {
        requireRole(ctx, 'OWNER');
        const input = z.object({ email: z.email(), role: z.string().min(1).max(140) }).parse(data);
        const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
        if (!user || user.id === ctx.user.id)
          throw new AppError('Use the email of another registered user');
        await db.$transaction(async (tx) => {
          // Serialize membership additions with removal of either account.
          // Lock both account rows in the same order as ownership transfers.
          const ownerId = ctx.org.workspaceOwnerId;
          if (!ownerId) throw new AppError('Workspace ownership requires reconciliation', 409);
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} OR id = ${user.id} ORDER BY id FOR UPDATE`;
          const currentOrg = await tx.organization.findUnique({
            where: { id: ctx.org.id },
            select: { workspaceOwnerId: true },
          });
          if (currentOrg?.workspaceOwnerId !== ownerId)
            throw new AppError('Workspace ownership changed; retry the operation', 409);
          await lockWritableWorkspace(tx, ctx, 'OWNER');
          const recipient = await tx.user.findUnique({
            where: { id: user.id },
            select: { email: true, deletedAt: true },
          });
          if (!recipient || recipient.deletedAt || recipient.email !== input.email.toLowerCase())
            throw new AppError('Use the email of another registered user');
          const actor = await tx.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: ctx.org.id, userId: ctx.user.id! } },
          });
          if (actor?.role !== 'OWNER') throw new AppError('Workspace owner access required', 403);
          const existing = await tx.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId: ctx.org.id, userId: user.id } },
          });
          if (existing?.role === 'OWNER') throw new AppError('Owner role cannot be changed here');
          let role: 'ADMIN' | 'EDITOR' | 'VIEWER';
          let customRoleId: string | null = null;
          if (input.role.startsWith('custom:')) {
            const custom = await tx.workspaceCustomRole.findFirst({
              where: { id: input.role.slice(7), organizationId: ctx.org.id },
            });
            if (!custom || custom.baseRole === 'OWNER')
              throw new AppError('Custom role is unavailable.', 403);
            role = custom.baseRole;
            customRoleId = custom.id;
          } else {
            role = z.enum(['ADMIN', 'EDITOR', 'VIEWER']).parse(input.role);
          }
          await tx.organizationMember.upsert({
            where: { organizationId_userId: { organizationId: ctx.org.id, userId: user.id } },
            create: { organizationId: ctx.org.id, userId: user.id, role, customRoleId },
            update: { role, customRoleId },
          });
          await audit(tx, ctx, 'team.member_updated', user.id, { role, customRoleId });
        });
        return Response.json({ ok: true });
      }
      case 'password.change': {
        const input = z
          .object({
            currentPassword: z.string().min(1).max(128),
            password: z.string().min(12).max(128),
          })
          .parse(data);
        await changeAccountPassword(
          ctx.user.id!,
          input.currentPassword,
          input.password,
          request.headers.get('x-forwarded-for')?.split(',')[0] || 'local',
          (tx) => audit(tx, ctx, 'security.password_changed'),
        );
        return Response.json({ ok: true, signInRequired: true });
      }
      case 'account.delete': {
        const input = z
          .object({
            currentPassword: z.string().min(1).max(128),
            confirmation: z.literal('DELETE ACCOUNT'),
          })
          .parse(data);
        await deleteAccount(ctx.user.id!, input.currentPassword);
        return Response.json({ ok: true });
      }
      case 'notifications.read': {
        const input = z
          .object({ ids: z.array(z.string().min(1).max(128)).min(1).max(10) })
          .strict()
          .parse(data);
        await markWorkspaceNotificationsRead(ctx.org.id, ctx.user.id!, input.ids);
        return Response.json({ ok: true });
      }
      case 'activity.read': {
        const input = z
          .object({
            workspaceId: z.string().min(1).max(128),
            ids: z.array(z.string().min(1).max(128)).min(1).max(workspaceActivityLimit),
          })
          .strict()
          .parse(data);
        if (input.workspaceId !== ctx.org.id)
          throw new AppError('The selected workspace changed.', 409);
        await markWorkspaceActivityRead(ctx.org.id, ctx.user.id!, input.ids);
        return Response.json({ ok: true });
      }
      case 'preferences.save': {
        const input = z
          .object({ notifications: z.boolean(), theme: z.enum(['light', 'dark', 'system']) })
          .parse(data);
        await db.$transaction(async (tx) => {
          const userId = ctx.user.id!;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { deletedAt: true },
          });
          if (!user || user.deletedAt) throw new AppError('Sign in required', 401);
          await tx.userPreference.upsert({
            where: { userId },
            create: { userId, ...input },
            update: input,
          });
        });
        return Response.json({ ok: true });
      }
      case 'workspace.delete': {
        requireRole(ctx, 'OWNER');
        const input = z.object({ confirmation: z.string() }).parse(data);
        if (input.confirmation !== `DELETE ${ctx.org.name}`)
          throw new AppError('Confirmation does not match');
        await deleteOwnedWorkspace(ctx.user.id!, ctx.org.id);
        return Response.json({ ok: true });
      }
      default:
        throw new AppError('Unsupported operation', 404);
    }
  } catch (e) {
    return error(e);
  }
}
