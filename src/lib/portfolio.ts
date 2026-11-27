import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import Papa from 'papaparse';
import { z } from 'zod';
import { db } from './db';
import {
  domainInput,
  normalizeDomain,
  conflict,
  installments,
  installmentDueDate,
  money,
} from './domain';
import type { Context } from './access';
import { requireRole } from './permissions';
import { AppError } from './security';
import { comparisonPage } from './comparison';
import { expirationWindow } from './expiration';
import { lockWritableWorkspace } from './workspace-write';
import { queueActivityNotice } from './activity-notices';
import { bulkActivity } from './bulk-activity';
import { csvImportRowLimit } from './bulk-limit';

const activityEmailTitles: Record<string, string> = {
  'csv.imported': 'Portfolio import completed',
  'renewal.manually_confirmed': 'Domain renewal recorded',
  'sale.recorded': 'Sale agreement recorded',
  'payment.recorded': 'Payout recorded',
  'team.member_updated': 'Workspace access updated',
};
export const domainInclude = {
  registrations: true,
  listings: true,
  tags: { include: { tag: true } },
} satisfies Prisma.DomainInclude;
/** A completed sale becoming incomplete restores an active domain slot. */
export async function audit(
  tx: Prisma.TransactionClient,
  ctx: Context,
  action: string,
  entityId?: string,
  detail?: Prisma.InputJsonValue,
) {
  const entry = await tx.auditLog.create({
    data: { organizationId: ctx.org.id, actorId: ctx.user.id!, action, entityId, detail },
  });
  const batch = bulkActivity(action, detail);
  const title = batch?.title ?? activityEmailTitles[action];
  if (title)
    await queueActivityNotice(tx, {
      eventId: `activity:${entry.id}`,
      category: batch ? 'bulk' : 'other',
      organizationId: ctx.org.id,
      recipientId: ctx.user.id!,
      title,
      message: batch
        ? `${batch.label} in ${ctx.org.name}.${batch.preview ? ` Affected domains include ${batch.preview}.` : ''}`
        : `${title} in ${ctx.org.name}.`,
    });
}
export async function ownedDomain(ctx: Context, id: string) {
  const domain = await db.domain.findFirst({
    where: { id, organizationId: ctx.org.id, deletedAt: null },
    include: {
      ...domainInclude,
      notes: { orderBy: { createdAt: 'desc' } },
      prices: { orderBy: { createdAt: 'desc' }, take: 100 },
      expenses: true,
      renewals: true,
      sales: {
        include: { payments: true, installments: true, commissions: true, adjustments: true },
      },
    },
  });
  if (!domain) throw new AppError('Domain not found', 404);
  return domain;
}
export function domainWhere(ctx: Context, query: URLSearchParams): Prisma.DomainWhereInput {
  const q = (query.get('q') || '').slice(0, 253);
  const tld = query.get('tld');
  const status = query.get('status');
  const registrar = query.get('registrar');
  const tag = query.get('tag');
  const expirationRange = expirationWindow(query);
  const effectiveStatus = status
    ? status !== 'all'
      ? status
      : undefined
    : query.get('matrix') === 'true' || query.get('renewals') === 'true'
      ? 'active'
      : undefined;
  return {
    organizationId: ctx.org.id,
    deletedAt: null,
    ...(q && { name: { contains: q.toLowerCase(), mode: 'insensitive' } }),
    ...(tld && { tld }),
    ...(effectiveStatus && { status: effectiveStatus }),
    ...((registrar || expirationRange) && {
      registrations: {
        some: {
          ...(registrar && { registrar }),
          ...(expirationRange && { expiresAt: expirationRange }),
        },
      },
    }),
    ...(query.get('listing') === 'none' && { listings: { none: {} } }),
    ...(tag && { tags: { some: { tag: { name: tag, organizationId: ctx.org.id } } } }),
  };
}
export async function listDomains(ctx: Context, query: URLSearchParams) {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.get('page')) || 1)));
  const take = Math.max(1, Math.min(500, Math.floor(Number(query.get('take')) || 25)));
  const where = domainWhere(ctx, query);
  const sort = query.get('sort') || 'name';
  if (
    query.get('matrix') === 'true' ||
    sort === 'comparison' ||
    sort === 'expiration' ||
    sort === 'registrar' ||
    sort === 'nameservers' ||
    sort === 'status' ||
    query.get('comparison') ||
    query.get('attention') === 'price-mismatch'
  ) {
    const result = await comparisonPage(ctx, query, page, take);
    const domains = await db.domain.findMany({
      where: { ...where, id: { in: result.rows.map((r) => r.id) } },
      include: domainInclude,
    });
    const byId = new Map(domains.map((d) => [d.id, d]));
    return {
      rows: result.rows.flatMap((item) => {
        const d = byId.get(item.id);
        return d
          ? [
              {
                ...d,
                conflict: conflict(d.listings),
                comparison: item.comparison,
                selectedRegistrationId: item.selectedRegistrationId,
              },
            ]
          : [];
      }),
      total: result.total,
      page,
      take,
    };
  }
  const key = ['name', 'askingPrice', 'acquisitionCost', 'createdAt'].includes(sort)
    ? sort
    : 'name';
  const [rows, total] = await db.$transaction([
    db.domain.findMany({
      where,
      include: domainInclude,
      orderBy: [
        {
          [key]:
            key === 'askingPrice'
              ? { sort: query.get('direction') === 'desc' ? 'desc' : 'asc', nulls: 'last' }
              : query.get('direction') === 'desc'
                ? 'desc'
                : 'asc',
        },
        { id: 'asc' },
      ],
      skip: (page - 1) * take,
      take,
    }),
    db.domain.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...r, conflict: conflict(r.listings) })), total, page, take };
}
export async function setRenewalEstimate(ctx: Context, raw: unknown) {
  requireRole(ctx);
  const input = z
    .object({
      registrationId: z.string(),
      amount: z
        .string()
        .regex(/^\d{1,12}(\.\d{1,2})?$/)
        .nullable(),
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx);
    const registration = await tx.domainRegistration.findFirst({
      where: { id: input.registrationId, domain: { organizationId: ctx.org.id, deletedAt: null } },
    });
    if (!registration) throw new AppError('Registration not found', 404);
    await tx.domainRegistration.update({
      where: { id: registration.id },
      data: { renewalCost: input.amount },
    });
    await audit(tx, ctx, 'renewal.estimate_updated', registration.domainId, {
      previousCost: registration.renewalCost?.toString() ?? null,
      newCost: input.amount,
      currency: registration.currency,
      registrationId: registration.id,
    });
    return { ok: true };
  });
}
export async function saveDomain(ctx: Context, raw: unknown, id?: string) {
  requireRole(ctx);
  const input = domainInput.parse(raw);
  const norm = normalizeDomain(input.name);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx);
    if (id) {
      const found = await tx.domain.findFirst({
        where: { id, organizationId: ctx.org.id, deletedAt: null },
      });
      if (!found) throw new AppError('Domain not found', 404);
      if (found.name !== norm.name)
        throw new AppError('Domain identity cannot be changed; add a separate asset');
      if (
        found.currency !== input.currency &&
        ((await tx.domainSale.count({ where: { domainId: id } })) ||
          (await tx.domainExpense.count({ where: { domainId: id } })))
      )
        throw new AppError('Accounting currency cannot change after financial records exist');
    }
    const existing = await tx.domain.findUnique({
      where: { organizationId_name: { organizationId: ctx.org.id, name: norm.name } },
    });
    if (!id && existing && !existing.deletedAt) throw new AppError('Domain already exists');
    const data = {
      ...norm,
      acquisitionCost: input.acquisitionCost,
      askingPrice: input.askingPrice ?? null,
      currency: input.currency,
      acquiredAt: input.acquiredAt ? new Date(input.acquiredAt) : null,
    };
    const domain = id
      ? await tx.domain.update({ where: { id }, data })
      : existing
        ? await tx.domain.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } })
        : await tx.domain.create({ data: { ...data, organizationId: ctx.org.id } });
    if (
      id &&
      (input.askingPrice !== undefined
        ? !existing?.askingPrice?.equals(input.askingPrice)
        : existing?.askingPrice !== null)
    )
      await tx.domainPriceHistory.create({
        data: {
          domainId: domain.id,
          marketplace: 'Internal asking price',
          previousPrice: existing?.askingPrice,
          price: input.askingPrice ?? null,
          currency: input.currency,
          source: 'manual',
        },
      });
    if (id) {
      await tx.domainRegistration.deleteMany({
        where: {
          domainId: domain.id,
          registrar: { not: input.registrar },
          OR: [{ registrar: 'Unknown' }, { registrar: 'Unassigned' }, { providerAccountId: null }],
        },
      });
    }
    await tx.domainRegistration.upsert({
      where: { domainId_registrar: { domainId: domain.id, registrar: input.registrar } },
      create: {
        domainId: domain.id,
        registrar: input.registrar,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        renewalCost: input.renewalCost,
        currency: input.currency,
        nameservers: [],
      },
      update: {
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        renewalCost: input.renewalCost,
        currency: input.currency,
        source: 'manual',
        verifiedAt: null,
      },
    });
    await tx.domainTagAssignment.deleteMany({ where: { domainId: domain.id } });
    for (const name of new Set(input.tags)) {
      const tag = await tx.domainTag.upsert({
        where: { organizationId_name: { organizationId: ctx.org.id, name } },
        create: { organizationId: ctx.org.id, name },
        update: {},
      });
      await tx.domainTagAssignment.create({ data: { domainId: domain.id, tagId: tag.id } });
    }
    await audit(tx, ctx, id ? 'domain.updated' : 'domain.created', domain.id, {
      previousAcquisitionCost: existing?.acquisitionCost.toString() ?? null,
      acquisitionCost: input.acquisitionCost,
      previousCurrency: existing?.currency ?? null,
      currency: input.currency,
    });
    return domain;
  });
}
export const csvRequest = z.object({
  csv: z.string().max(10_000_000),
  mapping: z.record(z.string(), z.string()),
  overwrite: z.boolean().default(false),
});
export function parseCsv(csv: string, mapping: Record<string, string>) {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (parsed.data.length > csvImportRowLimit)
    throw new AppError(`Import up to ${csvImportRowLimit.toLocaleString('en-US')} rows per file`);
  const seen = new Set<string>();
  const valid: (z.infer<typeof domainInput> & { providedFields: string[] })[] = [];
  const errors: { row: number; message: string }[] = parsed.errors.map((e) => ({
    row: (e.row ?? 0) + 2,
    message: e.message,
  }));
  const malformed = new Set(parsed.errors.filter((e) => e.row !== undefined).map((e) => e.row));
  parsed.data.forEach((row, i) => {
    if (malformed.has(i)) return;
    try {
      const mapped: Record<string, unknown> = {};
      for (const [field, column] of Object.entries(mapping))
        if (row[column]?.trim()) mapped[field] = row[column].trim();
      if (typeof mapped.tags === 'string')
        mapped.tags = mapped.tags
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean);
      const data = domainInput.parse(mapped);
      const normalized = normalizeDomain(data.name);
      if (seen.has(normalized.name)) throw new Error('Duplicate domain in this file');
      seen.add(normalized.name);
      valid.push({ ...data, name: normalized.name, providedFields: Object.keys(mapped) });
    } catch (e) {
      errors.push({
        row: i + 2,
        message:
          e instanceof z.ZodError
            ? e.issues.map((v) => `${v.path.join('.')}: ${v.message}`).join('; ')
            : (e as Error).message,
      });
    }
  });
  return { valid, errors, headers: parsed.meta.fields ?? [] };
}
export async function importCsv(ctx: Context, raw: unknown, confirm: boolean) {
  requireRole(ctx);
  const input = csvRequest.parse(raw);
  const overwrite = input.overwrite;
  const parsed = parseCsv(input.csv, input.mapping);
  const common = {
    errors: parsed.errors,
    preview: parsed.valid.slice(0, 10),
    valid: parsed.valid.length,
  };
  if (!confirm) {
    const existing = await db.domain.count({
      where: { organizationId: ctx.org.id, name: { in: parsed.valid.map((d) => d.name) } },
    });
    return {
      ...common,
      inserts: parsed.valid.length - existing,
      updates: overwrite ? existing : 0,
      skipped: overwrite ? 0 : existing,
    };
  }
  const counts = await db.$transaction(
    async (tx) => {
      await lockWritableWorkspace(tx, ctx);
      const names = await tx.domain.findMany({
        where: { organizationId: ctx.org.id, name: { in: parsed.valid.map((d) => d.name) } },
        select: { name: true },
      });
      const freshSet = new Set(names.map((d) => d.name));
      const additions = parsed.valid.length - freshSet.size;
      // Insert new rows in bounded batches. Existing rows follow the selective overwrite path.
      const newRows = parsed.valid.filter((row) => !freshSet.has(row.name));
      const created = newRows.map((row) => ({ row, id: randomUUID() }));
      const batchSize = 500;
      for (let offset = 0; offset < created.length; offset += batchSize) {
        const batch = created.slice(offset, offset + batchSize);
        await tx.domain.createMany({
          data: batch.map(({ row, id }) => ({
            id,
            organizationId: ctx.org.id,
            ...normalizeDomain(row.name),
            acquisitionCost: row.acquisitionCost,
            askingPrice: row.askingPrice,
            currency: row.currency,
            acquiredAt: row.acquiredAt ? new Date(row.acquiredAt) : undefined,
            source: 'csv',
          })),
        });
        await tx.domainRegistration.createMany({
          data: batch.map(({ row, id }) => ({
            domainId: id,
            registrar: row.registrar,
            expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
            renewalCost: row.renewalCost,
            currency: row.currency,
            source: 'csv',
            nameservers: [],
          })),
        });
        const prices = batch.filter(({ row }) => row.askingPrice !== undefined);
        if (prices.length)
          await tx.domainPriceHistory.createMany({
            data: prices.map(({ row, id }) => ({
              domainId: id,
              marketplace: 'Internal asking price',
              price: row.askingPrice!,
              currency: row.currency,
              source: 'csv',
            })),
          });
      }
      const tagNames = [...new Set(created.flatMap(({ row }) => row.tags))];
      const tags = new Map<string, string>();
      for (let offset = 0; offset < tagNames.length; offset += batchSize) {
        const names = tagNames.slice(offset, offset + batchSize);
        await tx.domainTag.createMany({
          data: names.map((name) => ({ organizationId: ctx.org.id, name })),
          skipDuplicates: true,
        });
        for (const tag of await tx.domainTag.findMany({
          where: { organizationId: ctx.org.id, name: { in: names } },
          select: { id: true, name: true },
        }))
          tags.set(tag.name, tag.id);
      }
      const assignments = created.flatMap(({ row, id }) =>
        [...new Set(row.tags)].map((name) => ({ domainId: id, tagId: tags.get(name)! })),
      );
      for (let offset = 0; offset < assignments.length; offset += batchSize)
        await tx.domainTagAssignment.createMany({
          data: assignments.slice(offset, offset + batchSize),
          skipDuplicates: true,
        });
      for (const input of parsed.valid) {
        if (!freshSet.has(input.name) || !overwrite) continue;
        const norm = normalizeDomain(input.name);
        const data = {
          ...norm,
          acquisitionCost: input.acquisitionCost,
          askingPrice: input.askingPrice,
          currency: input.currency,
          acquiredAt: input.acquiredAt ? new Date(input.acquiredAt) : undefined,
          source: 'csv',
        };
        const previous = await tx.domain.findUnique({
          where: { organizationId_name: { organizationId: ctx.org.id, name: norm.name } },
        });
        if (
          previous &&
          input.providedFields.includes('currency') &&
          previous.currency !== input.currency &&
          ((await tx.domainSale.count({ where: { domainId: previous.id } })) ||
            (await tx.domainExpense.count({ where: { domainId: previous.id } })))
        )
          throw new AppError(
            `Cannot change accounting currency of ${input.name} after financial records exist`,
          );
        const domain = await tx.domain.upsert({
          where: { organizationId_name: { organizationId: ctx.org.id, name: input.name } },
          create: { ...data, organizationId: ctx.org.id },
          update: {
            ...norm,
            source: 'csv',
            ...(input.providedFields.includes('acquisitionCost') && {
              acquisitionCost: input.acquisitionCost,
            }),
            ...(input.providedFields.includes('askingPrice') && { askingPrice: input.askingPrice }),
            ...(input.providedFields.includes('currency') && { currency: input.currency }),
            ...(input.providedFields.includes('acquiredAt') && { acquiredAt: data.acquiredAt }),
          },
        });
        if (input.askingPrice !== undefined && !previous?.askingPrice?.equals(input.askingPrice))
          await tx.domainPriceHistory.create({
            data: {
              domainId: domain.id,
              marketplace: 'Internal asking price',
              previousPrice: previous?.askingPrice,
              price: input.askingPrice,
              currency: domain.currency,
              source: 'csv',
            },
          });
        const registrationFields = ['registrar', 'expiresAt', 'renewalCost'];
        if (!previous || input.providedFields.some((field) => registrationFields.includes(field))) {
          const currentRegistration =
            previous && !input.providedFields.includes('registrar')
              ? await tx.domainRegistration.findFirst({ where: { domainId: domain.id } })
              : null;
          const registrar = currentRegistration?.registrar || input.registrar;
          await tx.domainRegistration.upsert({
            where: { domainId_registrar: { domainId: domain.id, registrar } },
            create: {
              domainId: domain.id,
              registrar,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
              renewalCost: input.renewalCost,
              currency: domain.currency,
              source: 'csv',
              nameservers: [],
            },
            update: {
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
              renewalCost: input.renewalCost,
              source: 'csv',
              verifiedAt: null,
            },
          });
        }
        if (
          previous &&
          input.providedFields.includes('acquisitionCost') &&
          !previous.acquisitionCost.equals(input.acquisitionCost)
        )
          await audit(tx, ctx, 'domain.acquisition_cost_corrected', domain.id, {
            previousAcquisitionCost: previous.acquisitionCost.toString(),
            acquisitionCost: input.acquisitionCost,
            currency: domain.currency,
            source: 'csv',
          });
        for (const name of input.tags) {
          const tag = await tx.domainTag.upsert({
            where: { organizationId_name: { organizationId: ctx.org.id, name } },
            update: {},
            create: { organizationId: ctx.org.id, name },
          });
          await tx.domainTagAssignment.upsert({
            where: { domainId_tagId: { domainId: domain.id, tagId: tag.id } },
            create: { domainId: domain.id, tagId: tag.id },
            update: {},
          });
        }
      }
      await audit(tx, ctx, 'csv.imported', undefined, {
        inserts: additions,
        validRows: parsed.valid.length,
        errors: parsed.errors.length,
      });
      return {
        inserts: additions,
        updates: overwrite ? freshSet.size : 0,
        skipped: overwrite ? 0 : freshSet.size,
      };
    },
    { timeout: 120000 },
  );
  return { ...common, ...counts, confirmed: true };
}
const payoutInput = z.object({
  amount: money,
  commissionWithheld: money.optional(),
  receivedAt: z.string().date().nullable().optional(),
  reference: z.string().trim().min(1).max(100),
});
export function settlePayout(
  gross: Decimal.Value,
  commission: Decimal.Value,
  cash: Decimal.Value,
  held: Decimal.Value,
  input: { amount: string; commissionWithheld?: string },
) {
  const alreadySettled = new Decimal(cash).plus(held);
  const gap = new Decimal(gross).minus(alreadySettled).minus(input.amount);
  // Partial receipts do not establish how a marketplace split its fees.
  const inferred = gap.gte(0) && new Decimal(held).plus(gap).lte(commission) ? gap : 0;
  const withheld = new Decimal(input.commissionWithheld ?? inferred);
  const incoming = new Decimal(input.amount).plus(withheld);
  if (incoming.lte(0)) throw new AppError('A payout must settle a positive amount');
  const settled = alreadySettled.plus(incoming);
  if (settled.gt(gross))
    throw new AppError(
      'The payout exceeds the remaining agreement balance. Enter the amount received.',
    );
  if (new Decimal(held).plus(withheld).gt(commission))
    throw new AppError('Withheld fees exceed the recorded total commission');
  return { settled, commissionWithheld: withheld.toFixed(2) };
}

/** Reconcile the ledger after correcting its agreement or recorded cash. */
export async function reconcileEditedPayouts(
  tx: Prisma.TransactionClient,
  gross: Decimal.Value,
  commission: Decimal.Value,
  payments: { id: string; amount: Decimal.Value; commissionWithheld: Decimal.Value }[],
) {
  const cash = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
  const gap = new Decimal(gross).minus(cash);
  if (gap.lt(0)) throw new AppError('Recorded payouts exceed the agreement amount');
  if (!payments.length) return cash;
  const held = payments.reduce(
    (sum, payment) => sum.plus(payment.commissionWithheld),
    new Decimal(0),
  );
  const reconciled = gap.lte(commission) ? gap : Decimal.min(held, commission);
  if (!reconciled.eq(held)) {
    let remaining = reconciled;
    for (const [index, payment] of payments.entries()) {
      const amount =
        index === payments.length - 1
          ? remaining
          : Decimal.min(payment.commissionWithheld, remaining);
      if (!amount.eq(payment.commissionWithheld))
        await tx.salePayment.update({
          where: { id: payment.id },
          data: { commissionWithheld: amount.toFixed(2) },
        });
      remaining = remaining.minus(amount);
    }
  }
  return cash.plus(reconciled);
}
export async function recordPayment(ctx: Context, raw: unknown) {
  requireRole(ctx);
  const input = payoutInput.extend({ saleId: z.string() }).parse(raw);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
    const sale = await tx.domainSale.findFirst({
      where: { id: input.saleId, domain: { organizationId: ctx.org.id } },
      include: { commissions: true },
    });
    if (!sale) throw new AppError('Sale not found', 404);
    await tx.$queryRaw`SELECT id FROM "DomainSale" WHERE id=${sale.id} FOR UPDATE`;
    const previous = await tx.salePayment.findUnique({
      where: { saleId_reference: { saleId: sale.id, reference: input.reference } },
    });
    if (previous) {
      if (
        previous.amount.eq(input.amount) &&
        (input.commissionWithheld === undefined ||
          previous.commissionWithheld.eq(input.commissionWithheld)) &&
        (previous.receivedAt?.toISOString().slice(0, 10) ?? null) === (input.receivedAt ?? null)
      )
        return { ok: true, duplicate: true };
      throw new AppError('This payment reference already exists with different values', 409);
    }
    const paid = await tx.salePayment.aggregate({
      where: { saleId: sale.id },
      _sum: { amount: true, commissionWithheld: true },
    });
    const commission = sale.commissions.reduce(
      (sum, item) => sum.plus(item.amount),
      new Decimal(0),
    );
    const { settled, commissionWithheld } = settlePayout(
      sale.grossAmount,
      commission,
      paid._sum.amount ?? 0,
      paid._sum.commissionWithheld ?? 0,
      input,
    );
    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        amount: input.amount,
        commissionWithheld,
        currency: sale.currency,
        reference: input.reference,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
      },
    });
    await tx.domainSale.update({
      where: { id: sale.id },
      data: { status: settled.eq(sale.grossAmount) ? 'completed' : 'paying' },
    });
    await audit(tx, ctx, 'payment.recorded', sale.id, {
      amount: input.amount,
      commissionWithheld,
      reference: input.reference,
      receivedAt: input.receivedAt ?? null,
    });
    return { ok: true };
  });
}
export async function recordSale(ctx: Context, raw: unknown) {
  requireRole(ctx);
  const input = z
    .object({
      domainId: z.string(),
      marketplace: z.string().min(1).max(80),
      grossAmount: money,
      currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
      commission: money.default('0'),
      count: z.number().int().min(1).max(120).default(1),
      soldAt: z.string().date(),
      initialPayment: payoutInput.optional(),
    })
    .parse(raw);
  const domain = await ownedDomain(ctx, input.domainId);
  if (domain.currency !== input.currency)
    throw new AppError('Sale currency must match domain accounting currency');
  if (new Decimal(input.commission).gt(input.grossAmount))
    throw new AppError('Commission exceeds sale amount');
  const schedule = installments(input.grossAmount, input.count);
  const initialPayment = input.initialPayment;
  const initialSettlement =
    initialPayment &&
    settlePayout(input.grossAmount, input.commission, 0, 0, {
      ...initialPayment,
      // Older sale forms sent a zero even when the final payout excluded the full fee.
      commissionWithheld:
        initialPayment.commissionWithheld !== undefined &&
        new Decimal(initialPayment.commissionWithheld).eq(0) &&
        new Decimal(initialPayment.amount).plus(input.commission).eq(input.grossAmount)
          ? undefined
          : initialPayment.commissionWithheld,
    });
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
    await tx.$queryRaw`SELECT id FROM "Domain" WHERE id = ${domain.id} FOR UPDATE`;
    if (await tx.domainSale.count({ where: { domainId: domain.id } }))
      throw new AppError('This domain already has a recorded sale');
    const sale = await tx.domainSale.create({
      data: {
        domainId: domain.id,
        marketplace: input.marketplace,
        grossAmount: input.grossAmount,
        currency: input.currency,
        kind: input.count > 1 ? 'lto' : 'outright',
        status: initialSettlement
          ? initialSettlement.settled.eq(input.grossAmount)
            ? 'completed'
            : 'paying'
          : 'signed',
        soldAt: new Date(input.soldAt),
        commissions: { create: { amount: input.commission, currency: input.currency } },
        payments:
          initialPayment && initialSettlement
            ? {
                create: {
                  amount: initialPayment.amount,
                  commissionWithheld: initialSettlement.commissionWithheld,
                  currency: input.currency,
                  reference: initialPayment.reference,
                  receivedAt: initialPayment.receivedAt
                    ? new Date(initialPayment.receivedAt)
                    : null,
                },
              }
            : undefined,
        installments: {
          create: schedule.map((amount, i) => {
            return { sequence: i + 1, amount, dueAt: installmentDueDate(input.soldAt, i) };
          }),
        },
      },
    });
    await tx.domain.update({
      where: { id: domain.id },
      data: { status: input.count > 1 ? 'lto' : 'sold' },
    });
    await audit(tx, ctx, 'sale.recorded', sale.id, { installmentCount: input.count });
    if (initialPayment && initialSettlement)
      await audit(tx, ctx, 'payment.recorded', sale.id, {
        amount: initialPayment.amount,
        commissionWithheld: initialSettlement.commissionWithheld,
        reference: initialPayment.reference,
        receivedAt: initialPayment.receivedAt ?? null,
      });
    return sale;
  });
}

export async function deleteSale(ctx: Context, saleId: string) {
  requireRole(ctx);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'financeRecords');
    await tx.$queryRaw`SELECT s.id FROM "DomainSale" s JOIN "Domain" d ON d.id = s."domainId" WHERE s.id = ${saleId} AND d."organizationId" = ${ctx.org.id} FOR UPDATE OF s`;
    const sale = await tx.domainSale.findFirst({
      where: { id: saleId, domain: { organizationId: ctx.org.id } },
      include: { domain: true },
    });
    if (!sale) throw new AppError('Sale not found', 404);

    const otherSales = await tx.domainSale.findMany({
      where: { domainId: sale.domainId, id: { not: sale.id } },
      select: { status: true },
    });
    await tx.domainSale.delete({ where: { id: sale.id } });

    if (otherSales.length === 0) {
      await tx.domain.update({
        where: { id: sale.domainId },
        data: { status: 'active' },
      });
    }

    await audit(tx, ctx, 'sale.deleted', sale.id, {
      domain: sale.domain.name,
      grossAmount: sale.grossAmount.toString(),
      marketplace: sale.marketplace,
    });

    return { ok: true, domain: sale.domain.name };
  });
}
