import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import * as providerActions from '../src/integrations/actions';
import { queueListingStats, runListingStats } from '../src/integrations/listing-stats';
import { setRenewalEstimate } from '../src/lib/portfolio';
import { marketplaceCounters } from '../src/lib/marketplace-analytics';
import {
  previewProviderChange,
  confirmProviderChange,
  confirmProviderChanges,
  runProviderChange,
} from '../src/lib/provider-changes';
import type { Context } from '../src/lib/access';
import { db } from '../src/lib/db';
import {
  saveDomain,
  listDomains,
  ownedDomain,
  importCsv,
  recordSale,
  recordPayment,
  deleteSale,
} from '../src/lib/portfolio';
import { runSync, queueSync } from '../src/integrations/sync';
import { encrypt } from '../src/lib/security';
import aft from './fixtures/afternic.json';
import aftSales from './fixtures/afternic-sales.json';
import aftStats from './fixtures/afternic-stats.json';
import { dashboard } from '../src/lib/dashboard';
import {
  previewListingPrice,
  confirmListingPrice,
  previewMarketplacePrices,
  confirmMarketplacePrices,
  runListingPriceJob,
} from '../src/lib/listing-prices';
const enabled = !!process.env.TEST_DATABASE_URL;
// This suite only creates and removes its own uniquely identified organizations/users.
describe.skipIf(!enabled)('PostgreSQL tenancy, imports, accounting and synchronization', () => {
  let a: Context;
  let b: Context;
  const prefix = `test-${randomUUID()}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error(
        'Run persistence tests with DATABASE_URL=TEST_DATABASE_URL to avoid an unintended database',
      );
    for (const id of ['spaceship', 'atom'])
      await db.provider.upsert({
        where: { id },
        create: { id, name: id, kind: 'both' },
        update: {},
      });
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: {
          email: `${prefix}-${i}@example.test`,
        },
      });
      userIds.push(user.id);
      const org = await db.organization.create({
        data: {
          name: `${prefix}-${i}`,
          workspaceOwnerId: user.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
        include: {},
      });
      orgIds.push(org.id);
      const ctx = {
        user: { id: user.id, email: user.email },
        org,
        role: 'OWNER' as const,
        members: [],
      } as Context;
      if (i === 0) a = ctx;
      else b = ctx;
    }
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });
  it('isolates identical domain names and blocks foreign IDs', async () => {
    const first = await saveDomain(a, { name: 'ISOLATION.test', acquisitionCost: '12.98' });
    await saveDomain(b, { name: 'isolation.test', acquisitionCost: '99' });
    expect(
      (await listDomains(a, new URLSearchParams('q=isolation'))).rows[0].acquisitionCost.toString(),
    ).toBe('12.98');
    await expect(ownedDomain(b, first.id)).rejects.toThrow('not found');
    await expect(saveDomain(b, { name: 'isolation.test' }, first.id)).rejects.toThrow('not found');
  });
  it('imports 60 records idempotently and writes an audit record', async () => {
    const csv =
      'name,cost\n' + Array.from({ length: 60 }, (_, i) => `import-${i}.test,0.10`).join('\n');
    const input = { csv, mapping: { name: 'name', acquisitionCost: 'cost' } };
    expect((await importCsv(a, input, false)).inserts).toBe(60);
    await importCsv(a, input, true);
    expect((await importCsv(a, input, false)).inserts).toBe(0);
    await importCsv(a, input, true);
    expect(
      await db.domain.count({
        where: { organizationId: a.org.id, name: { startsWith: 'import-' } },
      }),
    ).toBe(60);
    expect(
      await db.auditLog.count({ where: { organizationId: a.org.id, action: 'csv.imported' } }),
    ).toBe(2);
  });

  it('does not erase financial fields on a partial CSV update', async () => {
    const domain = await saveDomain(a, {
      name: 'partial.test',
      acquisitionCost: '125.50',
      askingPrice: '2499',
      currency: 'EUR',
      registrar: 'Original registrar',
    });
    await importCsv(
      a,
      {
        csv: 'domain,cost,price\npartial.test,,3499',
        mapping: { name: 'domain', acquisitionCost: 'cost', askingPrice: 'price' },
        overwrite: true,
      },
      true,
    );
    const updated = await ownedDomain(a, domain.id);
    expect(updated.acquisitionCost.toString()).toBe('125.5');
    expect(updated.currency).toBe('EUR');
    expect(updated.askingPrice?.toString()).toBe('3499');
    expect(updated.registrations).toHaveLength(1);
    expect(updated.registrations[0].registrar).toBe('Original registrar');
  });
  it('records signed LTO installments without inventing cash', async () => {
    const domain = await saveDomain(a, { name: 'lto.test', acquisitionCost: '12.98' });
    const sale = await recordSale(a, {
      domainId: domain.id,
      grossAmount: '1545',
      commission: '154.50',
      currency: 'USD',
      marketplace: 'Private',
      count: 17,
      soldAt: '2026-11-06',
    });
    expect(await db.salePayment.count({ where: { saleId: sale.id } })).toBe(0);
    const schedule = await db.saleInstallment.aggregate({
      where: { saleId: sale.id },
      _sum: { amount: true },
      _count: true,
    });
    expect(schedule._count).toBe(17);
    expect(schedule._sum.amount!.toString()).toBe('1545');
    await expect(
      recordSale(b, {
        domainId: domain.id,
        grossAmount: '100',
        currency: 'USD',
        marketplace: 'Private',
        count: 1,
        soldAt: '2026-11-06',
      }),
    ).rejects.toThrow();
  });
  it('reconciles real-shaped mocked responses, preserves manual costs and marks absent listings stale', async () => {
    await db.provider.upsert({
      where: { id: 'afternic' },
      create: { id: 'afternic', name: 'Afternic', kind: 'marketplace' },
      update: {},
    });
    const account = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'afternic',
        label: 'fixture',
        credential: {
          create: {
            ciphertext: encrypt({ apiKey: 'mock-test-key', apiSecret: 'mock-test-secret' }),
          },
        },
      },
    });
    const existing = await saveDomain(a, {
      name: 'fixture.test',
      acquisitionCost: '89.10',
      askingPrice: '5500',
    });
    const absent = await saveDomain(a, { name: 'absent.test' });
    await db.domainListing.create({
      data: {
        domainId: absent.id,
        providerAccountId: account.id,
        marketplace: 'afternic',
        binPrice: '100',
        verifiedAt: new Date('2020-01-01'),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          Response.json(
            url.includes('/sales') ? aftSales : url.includes('/stats') ? aftStats : aft,
          ),
        ),
    );
    const one = await queueSync(a, account.id);
    const two = await queueSync(a, account.id);
    expect(one.id).toBe(two.id);
    await runSync(one.id);
    const domain = await ownedDomain(a, existing.id);
    expect(domain.acquisitionCost.toString()).toBe('89.1');
    expect(domain.askingPrice!.toString()).toBe('5500');
    expect(domain.listings[0].binPrice!.toString()).toBe('4999');
    expect(domain.listings[0].source).toBe('afternic');
    const history = await db.domainPriceHistory.findMany({
      where: { domainId: existing.id, marketplace: 'afternic' },
    });
    expect(history).toHaveLength(1);
    expect(history[0].previousPrice).toBeNull();
    expect(history[0].price?.toString()).toBe('4999');
    const observation = await db.providerSaleObservation.findFirstOrThrow({
      where: { providerAccountId: account.id },
    });
    expect(observation.amount.toString()).toBe('1545');
    expect(observation.commissionAmount?.toString()).toBe('309');
    expect(observation.installmentAmount?.toString()).toBe('75.34');
    expect(observation.nextInstallmentAt?.toISOString().slice(0, 10)).toBe('2026-11-14');
    const report = (await dashboard(a)).providerSales.find((sale) => sale.id === observation.id)!;
    expect(report.previousInstallmentAt?.toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(report.disbursedAt).toBeNull();
    expect(JSON.stringify(observation)).not.toContain('authCode');
    expect(await db.salePayment.count({ where: { sale: { domainId: existing.id } } })).toBe(0);
    expect(await db.providerAnalytics.count({ where: { providerAccountId: account.id } })).toBe(1);
    expect((await ownedDomain(a, absent.id)).listings[0].stale).toBe(true);
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: one.id } })).status).toBe(
      'completed',
    );
    expect(
      await db.auditLog.count({ where: { organizationId: a.org.id, action: 'sync.completed' } }),
    ).toBe(1);
    vi.unstubAllGlobals();
  });
  it('preserves duplicate listing transitions and existing job item messages during a sync page', async () => {
    await db.provider.upsert({
      where: { id: 'afternic' },
      create: { id: 'afternic', name: 'Afternic', kind: 'marketplace' },
      update: {},
    });
    const account = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'afternic',
        label: `duplicates-${randomUUID()}`,
        credential: { create: { ciphertext: encrypt({ apiKey: 'test', apiSecret: 'test' }) } },
      },
    });
    const domain = await saveDomain(a, { name: 'duplicate-sync.test' });
    await db.domainListing.create({
      data: {
        domainId: domain.id,
        marketplace: 'afternic',
        providerAccountId: account.id,
        binPrice: '10',
        analytics: { views: 1, leads: 3 },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.includes('/sales')
            ? { sales: [], pagination: { total: 0 } }
            : url.includes('/stats')
              ? { stats: [] }
              : {
                  domains: [
                    {
                      name: domain.name,
                      buynowPrice: 100000000,
                      listStatus: 'ACTIVE',
                      intakeViews: 9,
                      intakeLeads: 4,
                    },
                    {
                      name: domain.name.toUpperCase(),
                      buynowPrice: 200000000,
                      listStatus: 'ACTIVE',
                      intakeViews: 12,
                      intakeLeads: 5,
                    },
                  ],
                  pagination: { total: 2 },
                },
        ),
      ),
    );
    try {
      const job = await queueSync(a, account.id);
      await db.syncJobItem.create({
        data: {
          jobId: job.id,
          domainName: domain.name,
          status: 'pending',
          message: 'Existing message',
        },
      });
      await runSync(job.id);
      expect(await db.syncJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        status: 'completed',
        added: 0,
        updated: 2,
      });
      const listing = await db.domainListing.findUniqueOrThrow({
        where: { domainId_marketplace: { domainId: domain.id, marketplace: 'afternic' } },
      });
      expect(listing.binPrice?.toString()).toBe('200');
      expect(listing.analytics).toMatchObject({ views: 12, leads: 5 });
      const history = await db.domainPriceHistory.findMany({
        where: { domainId: domain.id, marketplace: 'afternic' },
      });
      expect(
        history.map((item) => [item.previousPrice?.toString(), item.price?.toString()]),
      ).toEqual(
        expect.arrayContaining([
          ['10', '100'],
          ['100', '200'],
        ]),
      );
      expect(
        await db.syncJobItem.findUniqueOrThrow({
          where: { jobId_domainName: { jobId: job.id, domainName: domain.name } },
        }),
      ).toMatchObject({ status: 'verified', message: 'Existing message' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('aggregates dashboard data from persisted rows without loading the full portfolio', async () => {
    const result = await dashboard(a);
    expect(result.total).toBeGreaterThan(60);
    expect(result.monthly).toHaveLength(6);
    expect(result.renewalMonths).toHaveLength(12);
    expect(result.gross).toBe('1545.00');
    expect(result.collected).toBe('0');
    expect(result.providerSales).toHaveLength(1);
  });
  it('records provider failures accurately without leaking response secrets', async () => {
    const account = await db.providerAccount.findFirstOrThrow({
      where: { organizationId: a.org.id, providerId: 'afternic' },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{"token":"private-provider-token"}', { status: 403 })),
    );
    const job = await queueSync(a, account.id);
    await expect(runSync(job.id)).rejects.toThrow('HTTP 403');
    const result = await db.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(result.status).toBe('failed');
    expect(result.error).not.toContain('private-provider-token');
    expect((await db.providerAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe(
      'error',
    );
    vi.unstubAllGlobals();
  });
  it('publishes only an authorized, confirmed, current preview and verifies the remote BIN', async () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    a.org.pricePublishingEnabled = true;
    await db.organization.update({
      where: { id: a.org.id },
      data: { pricePublishingEnabled: true },
    });
    const listing = await db.domainListing.findFirstOrThrow({
      where: {
        marketplace: 'afternic',
        domain: { organizationId: a.org.id, name: 'fixture.test' },
      },
    });
    let remote = 1000;
    const fetcher = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        remote = JSON.parse(String(options.body)).buynowPrice / 1000000;
        return new Response(null, { status: 204 });
      }
      return Response.json({
        name: 'fixture.test',
        listStatus: 'ACTIVE',
        buynowPrice: remote * 1000000,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(previewListingPrice({ ...a, role: 'VIEWER' }, listing.id, '2000')).rejects.toThrow(
      'role',
    );
    await expect(previewListingPrice(b, listing.id, '2000')).rejects.toThrow('connected provider');
    const stale = await previewListingPrice(a, listing.id, '2000');
    remote = 1001;
    const staleJob = await confirmListingPrice(a, stale.id);
    await runListingPriceJob(staleJob.jobId);
    expect(
      (await db.listingPriceChange.findUniqueOrThrow({ where: { id: stale.id } })).status,
    ).toBe('failed');
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0);
    const preview = await previewListingPrice(a, listing.id, '2000');
    const job = await confirmListingPrice(a, preview.id);
    await expect(confirmListingPrice(a, preview.id)).rejects.toThrow('already confirmed');
    await runListingPriceJob(job.jobId);
    expect(
      (await db.listingPriceChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
    ).toBe('completed');
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
    expect(
      (
        await db.domainListing.findUniqueOrThrow({ where: { id: listing.id } })
      ).binPrice?.toString(),
    ).toBe('2000');
    expect((await ownedDomain(a, listing.domainId)).askingPrice?.toString()).toBe('5500');
    expect(
      await db.auditLog.count({
        where: { organizationId: a.org.id, action: 'listing.price_verified' },
      }),
    ).toBe(1);
    await runListingPriceJob(job.jobId);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
    const expired = await previewListingPrice(a, listing.id, '3000');
    await db.listingPriceChange.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(confirmListingPrice(a, expired.id)).rejects.toThrow('expired');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('does not call an accepted update successful without a matching fresh provider price', async () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    const listing = await db.domainListing.findFirstOrThrow({
      where: {
        marketplace: 'afternic',
        domain: { organizationId: a.org.id, name: 'fixture.test' },
      },
    });
    const fetcher = vi
      .fn()
      .mockImplementation(async (_url: string, options?: RequestInit) =>
        options?.method === 'PATCH'
          ? Response.json({})
          : Response.json({ name: 'fixture.test', listStatus: 'ACTIVE', buynowPrice: 2000000000 }),
      );
    vi.stubGlobal('fetch', fetcher);
    const preview = await previewListingPrice(a, listing.id, '3000');
    const job = await confirmListingPrice(a, preview.id);
    await runListingPriceJob(job.jobId);
    expect(
      (await db.listingPriceChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
    ).toBe('unverified');
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: job.jobId } })).status).toBe(
      'unverified',
    );
    expect((await db.domainListing.findUniqueOrThrow({ where: { id: listing.id } })).stale).toBe(
      true,
    );
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
    await runListingPriceJob(job.jobId);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('queues and verifies each marketplace in a confirmed portfolio asking price change', async () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    a.org.pricePublishingEnabled = true;
    await db.user.update({
      where: { id: a.user.id },
      data: {
        emailVerified: new Date(),
        preference: {
          upsert: { create: { activityEmails: true }, update: { activityEmails: true } },
        },
      },
    });
    await db.organization.update({
      where: { id: a.org.id },
      data: { pricePublishingEnabled: true },
    });
    const domain = await saveDomain(a, { name: 'price-batch.test' });
    const listings = [];
    for (const providerId of ['atom', 'spaceship']) {
      const account = await db.providerAccount.create({
        data: {
          organizationId: a.org.id,
          providerId,
          label: 'Price batch fixture',
          credential: {
            create: {
              ciphertext: encrypt({ apiKey: 'fixture', apiSecret: 'fixture', userId: '123' }),
            },
          },
        },
      });
      listings.push(
        await db.domainListing.create({
          data: { domainId: domain.id, marketplace: providerId, providerAccountId: account.id },
        }),
      );
    }
    await db.domainListing.create({
      data: { domainId: domain.id, marketplace: 'manual-fixture' },
    });
    const remote = { atom: 1000, spaceship: 2000 };
    let sends = 0;
    let rejectAtom = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options?: RequestInit) => {
        const url = new URL(input);
        if (url.hostname === 'www.atom.com') {
          if (url.pathname.endsWith('/update-selling-price')) {
            sends++;
            if (rejectAtom)
              return Response.json({ success: false, max_price: 3000 }, { status: 422 });
            remote.atom = Number(url.searchParams.get('selling_price'));
            return Response.json({ message: 'Successfully updated selling price' });
          }
          return Response.json({
            domain_name: domain.name,
            status: 'Approved',
            selling_price: remote.atom,
          });
        }
        if (options?.method === 'PATCH') {
          sends++;
          remote.spaceship = Number(JSON.parse(String(options.body)).binPrice.amount);
          return new Response(null, { status: 204 });
        }
        return Response.json({
          name: domain.name,
          status: 'listed',
          binPrice: { amount: String(remote.spaceship), currency: 'USD' },
        });
      }),
    );
    try {
      await expect(previewMarketplacePrices(b, listings[0].id, '3000')).rejects.toThrow(
        'not found',
      );
      const preview = await previewMarketplacePrices(a, listings[0].id, '3000');
      const ids = preview.previews.flatMap(({ preview }) => (preview ? [preview.id] : []));
      expect(ids).toHaveLength(2);
      expect(
        preview.previews.find(({ provider }) => provider === 'manual-fixture')?.reason,
      ).toContain('connected provider');
      expect(sends).toBe(0);
      const jobs = await confirmMarketplacePrices(a, ids);
      await expect(confirmMarketplacePrices(a, ids)).rejects.toThrow('already confirmed');
      expect((await ownedDomain(a, domain.id)).askingPrice?.toString()).toBe('3000');
      expect(sends).toBe(0);
      await Promise.all(jobs.map(({ jobId }) => runListingPriceJob(jobId)));
      expect(remote).toEqual({ atom: 3000, spaceship: 3000 });
      expect(sends).toBe(2);
      expect(
        await db.listingPriceChange.count({ where: { id: { in: ids }, status: 'completed' } }),
      ).toBe(2);
      const notices = () =>
        db.activityNotice.findMany({
          where: { organizationId: a.org.id, eventId: { startsWith: 'price' } },
          orderBy: { createdAt: 'asc' },
        });
      expect(await notices()).toMatchObject([
        { message: expect.stringContaining('2 of 2 marketplace prices verified') },
      ]);
      rejectAtom = true;
      const second = await previewMarketplacePrices(a, listings[0].id, '3500');
      const retryJobs = await confirmMarketplacePrices(
        a,
        second.previews.flatMap(({ preview }) => (preview ? [preview.id] : [])),
      );
      await runListingPriceJob(retryJobs[0].jobId);
      expect(await notices()).toHaveLength(1);
      await runListingPriceJob(retryJobs[1].jobId);
      expect(await notices()).toMatchObject([
        { message: expect.stringContaining('2 of 2 marketplace prices verified') },
        {
          message: expect.stringContaining(
            'Atom failed. Atom rejected the price. Enter $3,000 or less',
          ),
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it('synchronizes Namecheap registrations idempotently without creating marketplace listings', async () => {
    await db.provider.upsert({
      where: { id: 'namecheap' },
      create: { id: 'namecheap', name: 'Namecheap', kind: 'registrar' },
      update: {},
    });
    const account = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'namecheap',
        label: prefix,
        credential: {
          create: {
            ciphertext: encrypt({
              apiKey: `${prefix}-key`.slice(0, 50),
              apiUser: 'fixture',
              clientIp: '203.0.113.10',
            }),
          },
        },
      },
    });
    const fixture = readFileSync(new URL('./fixtures/namecheap.xml', import.meta.url), 'utf8')
      .replace(
        '</DomainGetListResult>',
        '<Domain ID="103" Name="bücher.test" /></DomainGetListResult>',
      )
      .replace('<TotalItems>2</TotalItems>', '<TotalItems>3</TotalItems>');
    const fetcher = vi.fn(async () => new Response(fixture));
    vi.stubGlobal('fetch', fetcher);
    try {
      for (let i = 0; i < 2; i++) {
        const job = await queueSync(a, account.id);
        await runSync(job.id);
        expect(await db.syncJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
          status: 'completed',
          added: i === 0 ? 2 : 0,
          updated: i === 0 ? 1 : 3,
        });
        if (i === 0) {
          const registration = await db.domainRegistration.findFirstOrThrow({
            where: {
              domain: { organizationId: a.org.id, name: 'namecheap-fixture.test' },
              registrar: 'Namecheap',
            },
          });
          // Namecheap's inventory does not return nameservers or manual renewal
          // cost; repeat synchronization must retain those existing values.
          await db.domainRegistration.update({
            where: { id: registration.id },
            data: {
              nameservers: ['ns1.example.test', 'ns2.example.test'],
              renewalCost: '12.50',
              currency: 'EUR',
            },
          });
        }
      }
      const domain = await db.domain.findUniqueOrThrow({
        where: {
          organizationId_name: { organizationId: a.org.id, name: 'namecheap-fixture.test' },
        },
        include: { registrations: true, listings: true },
      });
      expect(domain.registrations[0]).toMatchObject({
        registrar: 'Namecheap',
        autoRenew: true,
        source: 'namecheap',
        expiresAt: new Date('2027-02-28T00:00:00Z'),
        nameservers: ['ns1.example.test', 'ns2.example.test'],
        currency: 'EUR',
      });
      expect(domain.registrations[0].renewalCost?.toString()).toBe('12.5');
      expect(domain.listings).toHaveLength(0);
      expect(
        await db.domain.count({ where: { organizationId: a.org.id, source: 'namecheap' } }),
      ).toBe(2);
      await expect(ownedDomain(b, domain.id)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('sorts and filters comparison states before pagination and combines registrar/expiration filters', async () => {
    for (const [name, prices, currencies, stale] of [
      ['cmp-mismatch', [100, 200], ['USD', 'USD'], false],
      ['cmp-match', [100, 100], ['USD', 'USD'], false],
      ['cmp-unpriced', [100, null], ['USD', 'USD'], false],
      ['cmp-insufficient', [100], ['USD'], false],
      ['cmp-currency', [100, 100], ['USD', 'EUR'], false],
      ['cmp-stale', [100, 200], ['USD', 'USD'], true],
    ] as const)
      await db.domain.create({
        data: {
          organizationId: a.org.id,
          name: `${name}.test`,
          unicodeName: `${name}.test`,
          tld: 'test',
          listings: {
            create: prices.map((price, i) => ({
              marketplace: i ? 'atom' : 'afternic',
              binPrice: price,
              currency: currencies[i],
              stale,
            })),
          },
        },
      });
    const page = await listDomains(
      a,
      new URLSearchParams({
        q: 'cmp-',
        matrix: 'true',
        sort: 'comparison',
        direction: 'desc',
        take: '1',
      }),
    );
    expect(page.total).toBe(6);
    expect(page.rows[0].name).toBe('cmp-mismatch.test');
    const next = await listDomains(
      a,
      new URLSearchParams({
        q: 'cmp-',
        matrix: 'true',
        sort: 'comparison',
        direction: 'desc',
        take: '1',
        page: '2',
      }),
    );
    expect(next.rows[0].name).toBe('cmp-currency.test');
    const filtered = await listDomains(
      a,
      new URLSearchParams({ q: 'cmp-', comparison: 'insufficient', take: '500' }),
    );
    expect(filtered.take).toBe(500);
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].name).toBe('cmp-insufficient.test');
    const expired = new Date(Date.now() - 86400000),
      future = new Date(Date.now() + 7 * 86400000);
    await db.domain.create({
      data: {
        organizationId: a.org.id,
        name: 'renew-filter.test',
        unicodeName: 'renew-filter.test',
        tld: 'test',
        registrations: {
          create: [
            { registrar: 'Namecheap', expiresAt: expired },
            { registrar: 'Spaceship', expiresAt: future },
          ],
        },
      },
    });
    expect(
      (
        await listDomains(
          a,
          new URLSearchParams({ q: 'renew-filter', registrar: 'Namecheap', expiration: 'expired' }),
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await listDomains(
          a,
          new URLSearchParams({
            q: 'renew-filter',
            registrar: 'Namecheap',
            expiration: 'upcoming',
          }),
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await listDomains(
          a,
          new URLSearchParams({ q: 'renew-filter', registrar: 'Spaceship', days: '30' }),
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await listDomains(
          a,
          new URLSearchParams({
            q: 'renew-filter',
            registrar: 'Namecheap',
            days: '30',
            matrix: 'true',
          }),
        )
      ).total,
    ).toBe(0);
    expect((await listDomains(b, new URLSearchParams({ q: 'cmp-', matrix: 'true' }))).total).toBe(
      0,
    );
  });
  it('requires confirmation and current permissions, detects stale previews and verifies listing additions', async () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    await db.organization.update({
      where: { id: a.org.id },
      data: { providerActionsEnabled: true },
    });
    const ctx = { ...a, org: { ...a.org, providerActionsEnabled: true } };
    const domain = await saveDomain(ctx, { name: 'add-listing-fixture.test', askingPrice: '1234' });
    const account = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'spaceship',
        label: prefix + '-actions',
        credential: {
          create: { ciphertext: encrypt({ apiKey: 'fixture', apiSecret: 'fixture' }) },
        },
      },
    });
    let remote: providerActions.RemoteListing | null = null;
    const client = {
      listing: vi.fn(async () => remote),
      removeListing: vi.fn(),
      nameservers: vi.fn(),
      setNameservers: vi.fn(),
      addListing: vi.fn(async () => {
        remote = { name: domain.name, price: '2500.00', currency: 'USD', status: 'verifying' };
      }),
    };
    const spy = vi.spyOn(providerActions, 'actionClient').mockReturnValue(client);
    const input = {
      action: 'addListing',
      domainId: domain.id,
      accountId: account.id,
      price: '2500',
    };
    try {
      await expect(previewProviderChange({ ...ctx, role: 'VIEWER' }, input)).rejects.toThrow();
      await expect(previewProviderChange(b, input)).rejects.toThrow('not found');
      const preview = await previewProviderChange(ctx, input);
      expect(client.addListing).not.toHaveBeenCalled();
      await expect(
        confirmProviderChange(
          { ...ctx, org: { ...ctx.org, providerActionsEnabled: false } },
          preview.id,
        ),
      ).rejects.toThrow('Enable');
      const job = await confirmProviderChange(ctx, preview.id);
      await expect(confirmProviderChange(ctx, preview.id)).rejects.toThrow('already confirmed');
      const stale = await previewProviderChange(ctx, input);
      const [staleJob] = await confirmProviderChanges(ctx, [stale.id]);
      expect(
        await db.syncJob.count({
          where: { providerAccountId: account.id, kind: 'providerChange', status: 'queued' },
        }),
      ).toBe(2);
      await runProviderChange(job.jobId);
      await runProviderChange(job.jobId);
      expect(client.addListing).toHaveBeenCalledTimes(1);
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
      ).toBe('completed');
      expect(
        (await db.domain.findUniqueOrThrow({ where: { id: domain.id } })).askingPrice?.toString(),
      ).toBe('1234');
      expect(
        await db.domainListing.count({
          where: { domainId: domain.id, marketplace: 'spaceship', status: 'verifying' },
        }),
      ).toBe(1);
      remote = { name: domain.name, price: '9000', currency: 'USD', status: 'onSale' };
      await runProviderChange(staleJob.jobId);
      expect((await db.providerChange.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
        'failed',
      );
      expect(client.addListing).toHaveBeenCalledTimes(1);
      expect(
        await db.auditLog.count({
          where: { organizationId: a.org.id, action: 'provider.change_verified' },
        }),
      ).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('rejects removed TXT previews before contacting providers', async () => {
    const spy = vi.spyOn(providerActions, 'actionClient');
    try {
      await expect(
        previewProviderChange(a, {
          action: 'verificationTxt',
          domainId: 'removed',
          accountId: 'removed',
          host: '@',
          value: 'fixture',
        }),
      ).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('queues real listing statistics reads, isolates organizations and reports partial results without zeroing unavailable counters', async () => {
    const account = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'atom',
        label: prefix + '-stats',
        credential: { create: { ciphertext: encrypt({ apiKey: 'fixture-only', userId: '1234' }) } },
      },
    });
    const domains: { id: string; name: string }[] = [];
    for (let i = 0; i < 2; i++)
      domains.push(
        await db.domain.create({
          data: {
            organizationId: a.org.id,
            name: `statistics-fixture-${i}.test`,
            unicodeName: `statistics-fixture-${i}.test`,
            tld: 'test',
            listings: {
              create: {
                providerAccountId: account.id,
                marketplace: 'atom',
                analytics: { views: 7 },
              },
            },
          },
        }),
      );
    await expect(
      queueListingStats(
        b,
        domains.map((d) => d.id),
      ),
    ).rejects.toThrow('unavailable');
    await expect(
      queueListingStats(
        { ...a, role: 'VIEWER' },
        domains.map((d) => d.id),
      ),
    ).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get('domain_name') === domains[0].name
          ? Response.json({ total_views: 100, total_shortlists: 3, total_offers: 2 })
          : Response.json({ success: false }),
      ),
    );
    try {
      const queued = await queueListingStats(
        a,
        domains.map((d) => d.id),
      );
      await runListingStats(queued.jobs[0]);
      const job = await db.syncJob.findUniqueOrThrow({ where: { id: queued.jobs[0] } });
      expect(job.status).toBe('partial');
      expect(job.updated).toBe(1);
      const first = await db.domainListing.findUniqueOrThrow({
        where: { domainId_marketplace: { domainId: domains[0].id, marketplace: 'atom' } },
      });
      const second = await db.domainListing.findUniqueOrThrow({
        where: { domainId_marketplace: { domainId: domains[1].id, marketplace: 'atom' } },
      });
      expect(first.analytics).toMatchObject({ views: 100, offers: 2, shortlists: 3 });
      expect(second.analytics).toEqual({ views: 7 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('sorts expiration at the database level with unknown dates last and edits renewal estimates without changing verified dates', async () => {
    const rows = [];
    for (const [name, expiresAt] of [
      ['old', '2020-01-01T12:34:56Z'],
      ['future', '2030-01-01T12:34:56Z'],
      ['unknown', null],
    ] as const)
      rows.push(
        await db.domain.create({
          data: {
            organizationId: a.org.id,
            name: `renew-sort-${name}.test`,
            unicodeName: `renew-sort-${name}.test`,
            tld: 'test',
            registrations: {
              create: {
                registrar: 'Namecheap',
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                source: 'namecheap',
                verifiedAt: new Date(),
              },
            },
          },
          include: { registrations: true },
        }),
      );
    const first = await listDomains(
      a,
      new URLSearchParams({ q: 'renew-sort', sort: 'expiration', direction: 'asc', take: '1' }),
    );
    expect(first.rows[0].name).toBe('renew-sort-old.test');
    const last = await listDomains(
      a,
      new URLSearchParams({ q: 'renew-sort', sort: 'expiration', direction: 'desc', take: '1' }),
    );
    expect(last.rows[0].name).toBe('renew-sort-future.test');
    const registration = rows[0].registrations[0];
    await expect(
      setRenewalEstimate(b, { registrationId: registration.id, amount: '15.55' }),
    ).rejects.toThrow('not found');
    await expect(
      setRenewalEstimate(
        { ...a, role: 'VIEWER' },
        { registrationId: registration.id, amount: '15.55' },
      ),
    ).rejects.toThrow();
    await setRenewalEstimate(a, { registrationId: registration.id, amount: '15.55' });
    const saved = await db.domainRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(saved.renewalCost?.toString()).toBe('15.55');
    expect(saved.expiresAt).toEqual(registration.expiresAt);
    expect(saved.verifiedAt).toEqual(registration.verifiedAt);
    expect(saved.source).toBe('namecheap');
    expect(await db.domainExpense.count({ where: { domainId: rows[0].id } })).toBe(0);
  });
  it('records net payouts plus withheld commission atomically and rejects duplicate or excess settlement', async () => {
    const domain = await saveDomain(a, { name: 'net-payout-fixture.test', acquisitionCost: '12' });
    const sale = await recordSale(a, {
      domainId: domain.id,
      marketplace: 'Dynadot',
      grossAmount: '500',
      commission: '25',
      currency: 'USD',
      soldAt: '2026-10-06',
      initialPayment: {
        amount: '475',
        reference: 'checkout-fixture',
        receivedAt: null,
      },
    });
    expect(sale.status).toBe('completed');
    expect((await ownedDomain(a, domain.id)).status).toBe('sold');
    const payment = await db.salePayment.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(payment.amount.toString()).toBe('475');
    expect(payment.commissionWithheld.toString()).toBe('25');
    expect(payment.receivedAt).toBeNull();
    expect(
      (
        await recordPayment(a, {
          saleId: sale.id,
          amount: '475',
          commissionWithheld: '25',
          reference: 'checkout-fixture',
          receivedAt: null,
        })
      ).duplicate,
    ).toBe(true);
    await expect(
      recordPayment(b, { saleId: sale.id, amount: '1', reference: 'foreign' }),
    ).rejects.toThrow('not found');
    await expect(
      recordPayment(a, { saleId: sale.id, amount: '1', reference: 'overpay' }),
    ).rejects.toThrow('exceeds');
    const summary = await dashboard(a);
    expect(new Decimal(summary.undatedCash).gte('475')).toBe(true);
    const recorded = summary.sales.find((s) => s.id === sale.id)!;
    expect(recorded.status).toBe('completed');
    const other = await saveDomain(a, { name: 'invalid-payout-fixture.test' });
    await expect(
      recordSale(a, {
        domainId: other.id,
        marketplace: 'Fixture',
        grossAmount: '500',
        commission: '25',
        currency: 'USD',
        soldAt: '2026-10-06',
        initialPayment: { amount: '475', commissionWithheld: '26', reference: 'bad-fee' },
      }),
    ).rejects.toThrow();
    expect(await db.domainSale.count({ where: { domainId: other.id } })).toBe(0);
  });
  it('settles a final net payout from the agreement commission after partial receipts', async () => {
    const domain = await saveDomain(a, { name: 'net-installments-fixture.test' });
    const sale = await recordSale(a, {
      domainId: domain.id,
      marketplace: 'Fixture',
      grossAmount: '500',
      commission: '25',
      currency: 'USD',
      count: 2,
      soldAt: '2026-10-06',
      initialPayment: { amount: '200', reference: 'first-net-receipt' },
    });
    expect(sale.status).toBe('paying');
    const payout = { saleId: sale.id, amount: '275', reference: 'final-net-receipt' };
    await expect(recordPayment(a, { ...payout, amount: '300.01' })).rejects.toThrow(
      'exceeds the remaining agreement balance',
    );
    await recordPayment(a, payout);
    await expect(recordPayment(a, payout)).resolves.toMatchObject({ duplicate: true });
    const saved = await db.domainSale.findUniqueOrThrow({
      where: { id: sale.id },
      include: { payments: { orderBy: { amount: 'asc' } } },
    });
    expect(saved.status).toBe('completed');
    expect(
      saved.payments.map(({ amount, commissionWithheld }) => [
        amount.toFixed(2),
        commissionWithheld.toFixed(2),
      ]),
    ).toEqual([
      ['200.00', '0.00'],
      ['275.00', '25.00'],
    ]);
  });
  it('aggregates marketplace counters separately, keeps unknown metrics null and respects tenancy', async () => {
    const counters = await marketplaceCounters(a);
    const atom = counters.find((item) => item.marketplace === 'atom')!;
    expect(new Decimal(atom.views!).eq(107)).toBe(true);
    expect(atom.leads).toBeNull();
    expect(new Decimal(atom.offers!).eq(2)).toBe(true);
    expect(new Decimal(atom.shortlists!).eq(3)).toBe(true);
    expect(atom.observedCount).toBe(2);
    const other = await marketplaceCounters(b);
    expect(other.find((item) => item.marketplace === 'atom')?.views ?? null).toBeNull();
  });
  it('revokes a queued price change when workspace publishing is disabled', async () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    const listing = await db.domainListing.findFirstOrThrow({
      where: {
        marketplace: 'afternic',
        domain: { organizationId: a.org.id, name: 'fixture.test' },
      },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ name: 'fixture.test', listStatus: 'ACTIVE', buynowPrice: 2000000000 }),
      );
    vi.stubGlobal('fetch', fetcher);
    const preview = await previewListingPrice(a, listing.id, '4000');
    const job = await confirmListingPrice(a, preview.id);
    await db.organization.update({
      where: { id: a.org.id },
      data: { pricePublishingEnabled: false },
    });
    await runListingPriceJob(job.jobId);
    expect(
      (await db.listingPriceChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
    ).toBe('failed');
    expect(fetcher.mock.calls).toHaveLength(1);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('auto-reconciles withheld commission when net payout plus commission equals gross amount and combines dated marketplace traffic', async () => {
    const outright = await saveDomain(a, { name: 'detach.si', acquisitionCost: '12' });
    const settledSale = await recordSale(a, {
      domainId: outright.id,
      grossAmount: '500',
      commission: '25',
      currency: 'USD',
      marketplace: 'Dynadot',
      count: 1,
      soldAt: '2026-10-06',
      initialPayment: {
        amount: '475',
        commissionWithheld: '0',
        receivedAt: '2026-11-05',
        reference: 'Initial Dynadot payout',
      },
    });
    expect(settledSale.status).toBe('completed');
    const savedPayment = await db.salePayment.findFirstOrThrow({
      where: { saleId: settledSale.id },
    });
    expect(savedPayment.commissionWithheld.toString()).toBe('25');

    const matrixActive = await listDomains(a, new URLSearchParams({ matrix: 'true' }));
    expect(matrixActive.rows.some((r) => r.name === 'detach.si')).toBe(false);
    const matrixAll = await listDomains(a, new URLSearchParams({ matrix: 'true', status: 'all' }));
    expect(matrixAll.rows.some((r) => r.name === 'detach.si')).toBe(true);
    const matrixSold = await listDomains(
      a,
      new URLSearchParams({ matrix: 'true', status: 'sold' }),
    );
    expect(matrixSold.rows.some((r) => r.name === 'detach.si')).toBe(true);

    await db.provider.upsert({
      where: { id: 'atom' },
      create: { id: 'atom', name: 'Atom', kind: 'marketplace' },
      update: {},
    });
    const secondAccount = await db.providerAccount.create({
      data: {
        organizationId: a.org.id,
        providerId: 'atom',
        label: 'second-marketplace-stats',
      },
    });
    const today = new Date();
    const statDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const afternicAccount = await db.providerAccount.findFirstOrThrow({
      where: { organizationId: a.org.id, providerId: 'afternic' },
    });
    await db.providerAnalytics.upsert({
      where: {
        providerAccountId_date: {
          providerAccountId: afternicAccount.id,
          date: statDate,
        },
      },
      create: { providerAccountId: afternicAccount.id, date: statDate, views: 15, leads: 2 },
      update: { views: 15, leads: 2 },
    });
    await db.providerAnalytics.create({
      data: { providerAccountId: secondAccount.id, date: statDate, views: 25, leads: 3 },
    });
    const summary = await dashboard(a);
    const combinedRow = summary.providerStats.find(
      (row) => row.date === statDate.toISOString().slice(0, 10),
    );
    expect(combinedRow).toEqual({
      date: statDate.toISOString().slice(0, 10),
      views: 40,
      leads: 5,
    });
  });
  it('uses renewal estimates and keeps recorded investment after removing an expired domain', async () => {
    const before = await dashboard(a);
    const day = 86_400_000;
    const now = Date.now();
    const expiresAt = new Date(now - 20 * day).toISOString().slice(0, 10);
    const domain = await saveDomain(a, {
      name: 'removed-investment.test',
      acquisitionCost: '100.25',
      acquiredAt: new Date(now - 800 * day).toISOString().slice(0, 10),
      registrar: 'Fixture',
      expiresAt,
      renewalCost: '200',
    });
    const payment = { domainId: domain.id, currency: 'USD' };
    const at = new Date(now - 385 * day);
    const renewal = {
      ...payment,
      amount: '14.25',
      confirmedAt: at,
      expiresAt: new Date(expiresAt),
    };
    await db.$transaction([
      db.domain.update({ where: { id: domain.id }, data: { status: 'expired' } }),
      db.domainExpense.createMany({
        data: [
          { ...payment, amount: '14.25', occurredAt: at, category: 'renewal' },
          { ...payment, amount: '3.45', occurredAt: at, category: 'Renewal' },
          { ...payment, amount: '4.10', occurredAt: at, category: 'holding' },
          { ...payment, amount: '99', occurredAt: at, category: 'renewal', currency: 'EUR' },
        ],
      }),
      db.domainRenewal.createMany({
        // One mirrored expense and two confirmation-only payments.
        data: [renewal, renewal, { ...renewal, amount: '9.50' }],
      }),
    ]);
    const add = (base: string, change: string) => new Decimal(base).plus(change).toFixed(2);
    const expected = {
      investment: add(before.investment, '100.25'),
      expenses: add(before.expenses, '4.10'),
    };
    const expired = await dashboard(a);
    expect(new Decimal(expired.investment).toFixed(2)).toBe(expected.investment);
    expect(new Decimal(expired.expenses).toFixed(2)).toBe(expected.expenses);
    expect(expired).toMatchObject({
      renewals: add(before.renewals, '400.00'),
      totalInvestment: add(before.totalInvestment, '504.35'),
      netReturn: add(before.netReturn, '-504.35'),
    });

    await db.domain.update({ where: { id: domain.id }, data: { deletedAt: new Date() } });
    expect(await dashboard(a)).toMatchObject({
      investment: expired.investment,
      expenses: expired.expenses,
      renewals: add(before.renewals, '41.45'),
      totalInvestment: add(before.totalInvestment, '145.80'),
      netReturn: add(before.netReturn, '-145.80'),
      total: expired.total - 1,
    });
  });

  it('allows removing a recorded sale, reverts domain status to active, and tracks portfolio investment & net return', async () => {
    const testDom = await saveDomain(a, {
      name: 'sale-delete-test.org',
      acquisitionCost: '100',
      renewalCost: '15',
    });
    const testSale = await recordSale(a, {
      domainId: testDom.id,
      grossAmount: '1000',
      commission: '100',
      currency: 'USD',
      marketplace: 'Dynadot',
      count: 1,
      soldAt: '2026-11-01',
      initialPayment: {
        amount: '900',
        commissionWithheld: '100',
        receivedAt: '2026-11-02',
        reference: 'dynadot-delete-test-payout',
      },
    });

    expect((await ownedDomain(a, testDom.id)).status).toBe('sold');
    expect(await db.salePayment.count({ where: { saleId: testSale.id } })).toBe(1);

    // Cross-tenant access check
    await expect(deleteSale(b, testSale.id)).rejects.toThrow('Sale not found');

    // Delete the sale
    const delResult = await deleteSale(a, testSale.id);
    expect(delResult.ok).toBe(true);
    expect(delResult.domain).toBe('sale-delete-test.org');

    // Verify sale and child payment are deleted
    expect(await db.domainSale.count({ where: { id: testSale.id } })).toBe(0);
    expect(await db.salePayment.count({ where: { saleId: testSale.id } })).toBe(0);

    // Verify domain status is restored to active
    const restored = await ownedDomain(a, testDom.id);
    expect(restored.status).toBe('active');

    // Verify dashboard returns totalInvestment and netReturn correctly
    const summary = await dashboard(a);
    expect(summary.totalInvestment).toBeDefined();
    expect(summary.renewals).toBeDefined();
    expect(summary.netReturn).toBeDefined();
    // totalInvestment = investment + expenses + renewals
    const expectedInvestment = new Decimal(summary.investment)
      .plus(summary.expenses)
      .plus(summary.renewals)
      .toFixed(2);
    expect(summary.totalInvestment).toBe(expectedInvestment);
    // netReturn = collected - totalInvestment
    const expectedReturn = new Decimal(summary.collected).minus(expectedInvestment).toFixed(2);
    expect(summary.netReturn).toBe(expectedReturn);
  });
});
