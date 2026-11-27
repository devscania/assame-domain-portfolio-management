import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import type { Context } from '../src/lib/access';
const fixture = vi.hoisted(() => ({ orgId: '', userId: '', sessionId: '' }));
const current = new Date();
const calendarStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 2, 1));
const calendarEnd = new Date(
  Date.UTC(calendarStart.getUTCFullYear(), calendarStart.getUTCMonth() + 1, 1),
);
const calendarMonth = calendarStart.toISOString().slice(0, 7);
vi.mock('@/lib/access', () => ({
  context: async () => ({
    org: { id: fixture.orgId, currency: 'USD' },
    user: { id: fixture.userId },
  }),
}));
vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: fixture.userId }, loginSessionId: fixture.sessionId }),
}));
import { listDomains } from '../src/lib/portfolio';
import { dashboard } from '../src/lib/dashboard';
import { GET as exportPortfolio } from '../src/app/api/export/route';
describe.skipIf(!process.env.TEST_DATABASE_URL)('actionable portfolio insight filters', () => {
  let orgId = '',
    otherId = '',
    userId = '';
  const ctx = () => ({ org: { id: orgId, currency: 'USD' }, user: { id: userId } }) as Context;
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated database required');
    userId = (await db.user.create({ data: { email: `insights-${randomUUID()}@example.test` } }))
      .id;
    orgId = (
      await db.organization.create({
        data: { name: 'Insight fixture', members: { create: { userId, role: 'OWNER' } } },
      })
    ).id;
    otherId = (await db.organization.create({ data: { name: 'Isolated fixture' } })).id;
    Object.assign(fixture, { orgId, userId, sessionId: randomUUID() });
    await db.accountLoginSession.create({
      data: {
        id: fixture.sessionId,
        userId,
        method: 'credentials',
        sessionVersion: 0,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    async function domain(
      name: string,
      status: string,
      prices: [number, string, boolean][] = [],
      organizationId = orgId,
    ) {
      return db.domain.create({
        data: {
          name,
          unicodeName: name,
          tld: 'test',
          organizationId,
          status,
          listings: {
            create: prices.map(([binPrice, currency, stale], i) => ({
              marketplace: i ? 'atom' : 'afternic',
              binPrice,
              currency,
              stale,
              status: 'active',
              source: 'fixture',
            })),
          },
        },
      });
    }
    await domain('missing.test', 'active');
    await domain('sold-unlisted.test', 'sold');
    await domain('price.test', 'active', [
      [100, 'USD', false],
      [200, 'USD', false],
    ]);
    await domain('currency-stale-sold.test', 'sold', [
      [100, 'USD', true],
      [100, 'EUR', true],
    ]);
    await domain('zero-price.test', 'active', [
      [0, 'USD', false],
      [100, 'USD', false],
    ]);
    await domain('matching.test', 'active', [
      [100, 'USD', false],
      [100, 'USD', false],
    ]);
    await domain(
      'private.test',
      'active',
      [
        [100, 'USD', false],
        [200, 'USD', false],
      ],
      otherId,
    );
    await domain('private-missing.test', 'active', [], otherId);
    const domains = await db.domain.findMany({ where: { organizationId: orgId } });
    const registrations: [string, string, string][] = [
      ['price.test', 'Zulu Custom', calendarStart.toISOString()],
      ['price.test', 'alpha registrar', calendarEnd.toISOString()],
      [
        'price.test',
        'Beta Registrar',
        new Date(calendarStart.getTime() + 19 * 86400000).toISOString(),
      ],
      [
        'sold-unlisted.test',
        'Atom',
        new Date(calendarStart.getTime() + 14 * 86400000).toISOString(),
      ],
      ['matching.test', 'Dynadot', new Date(calendarEnd.getTime() - 1).toISOString()],
      ['currency-stale-sold.test', 'GoDaddy', new Date(calendarStart.getTime() - 1).toISOString()],
      ['zero-price.test', 'Namecheap', calendarEnd.toISOString()],
    ];
    await db.domainRegistration.createMany({
      data: registrations.map(([name, registrar, expiresAt]) => ({
        domainId: domains.find((item) => item.name === name)!.id,
        registrar,
        expiresAt: new Date(expiresAt),
        nameservers: {
          'Zulu Custom': ['ns2.alpha.test', 'NS1.ALPHA.TEST'],
          'alpha registrar': ['ns1.other.test'],
          Dynadot: ['ns1.beta.test'],
        }[registrar] ?? [],
        source: 'fixture',
      })),
    });
  });
  it('sorts the displayed nameserver set across pages and keeps empty sets last', async () => {
    const first = await listDomains(ctx(), new URLSearchParams('sort=nameservers&take=1'));
    const second = await listDomains(ctx(), new URLSearchParams('sort=nameservers&take=1&page=2'));
    const descending = await listDomains(ctx(), new URLSearchParams('sort=nameservers&direction=desc'));
    expect(first.rows[0].name).toBe('price.test');
    expect(second.rows[0].name).toBe('matching.test');
    expect(descending.rows.slice(0, 2).map((row) => row.name)).toEqual(['matching.test', 'price.test']);
    const price = first.rows[0];
    expect(price).toHaveProperty('selectedRegistrationId',
      price.registrations.find((registration) => registration.registrar === 'Zulu Custom')?.id);
  });
  it('totals one positive BIN per domain while retaining the marketplace listing count', async () => {
    const summary = await dashboard(ctx());
    expect(summary.listingValue).toBe('400.00');
    expect(summary.listedBinDomainCount).toBe(4);
    expect(summary.listingCount).toBe(7);
  });
  it('sorts every registrar alphabetically across the full result and pagination', async () => {
    const asc = await listDomains(
      ctx(),
      new URLSearchParams('sort=registrar&direction=asc&status=all'),
    );
    const desc = await listDomains(
      ctx(),
      new URLSearchParams('sort=registrar&direction=desc&status=all'),
    );
    expect(asc.rows.map((row) => row.name)).toEqual([
      'price.test',
      'sold-unlisted.test',
      'matching.test',
      'currency-stale-sold.test',
      'zero-price.test',
      'missing.test',
    ]);
    expect(desc.rows.map((row) => row.name)).toEqual([
      'zero-price.test',
      'currency-stale-sold.test',
      'matching.test',
      'sold-unlisted.test',
      'price.test',
      'missing.test',
    ]);
    const paged = [];
    for (let page = 1; page <= 3; page++) {
      const result = await listDomains(
        ctx(),
        new URLSearchParams(`sort=registrar&direction=asc&status=all&take=2&page=${page}`),
      );
      expect(result.total).toBe(6);
      paged.push(...result.rows.map((row) => row.name));
    }
    expect(paged).toEqual(asc.rows.map((row) => row.name));
    const price = asc.rows.find((row) => row.name === 'price.test')!;
    expect(price).toHaveProperty(
      'selectedRegistrationId',
      price.registrations.find((reg) => reg.registrar === 'alpha registrar')!.id,
    );
    const filtered = await listDomains(
      ctx(),
      new URLSearchParams('sort=registrar&registrar=Zulu+Custom'),
    );
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]).toHaveProperty(
      'selectedRegistrationId',
      price.registrations.find((reg) => reg.registrar === 'Zulu Custom')!.id,
    );
  });
  it('drills into UTC calendar bounds and distinguishes registration counts from domain rows', async () => {
    const result = await listDomains(
      ctx(),
      new URLSearchParams(`month=${calendarMonth}&status=active&sort=expiration`),
    );
    expect(result.rows.map((row) => row.name)).toEqual(['price.test', 'matching.test']);
    const january = (await dashboard(ctx())).renewalMonths.find(
      (item) => item.month === calendarMonth,
    );
    expect(january?.count).toBe(3);
    const price = result.rows[0];
    expect(price).toHaveProperty(
      'selectedRegistrationId',
      price.registrations.find((reg) => reg.registrar === 'Zulu Custom')!.id,
    );
    const exported = await exportPortfolio(
      new Request(`http://localhost/api/export?month=${calendarMonth}&status=active`),
    );
    const csv = await exported.text();
    expect(csv.trim().split('\r\n')).toHaveLength(3);
    expect(csv).not.toContain('private');
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherId] } } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  it('returns the exact summary price-difference population including currency/stale/zero and lifecycle cases', async () => {
    const summary = await dashboard(ctx());
    const query = new URLSearchParams('attention=price-mismatch&status=all&matrix=true');
    const result = await listDomains(ctx(), query);
    expect(summary.conflicts).toBe(3);
    expect(result.total).toBe(summary.conflicts);
    expect(result.rows.map((r) => r.name).sort()).toEqual([
      'currency-stale-sold.test',
      'price.test',
      'zero-price.test',
    ]);
    const page = await listDomains(ctx(), new URLSearchParams(query.toString() + '&take=1&page=2'));
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
    const exported = await exportPortfolio(new Request('http://localhost/api/export?' + query));
    const csv = await exported.text();
    expect(csv.trim().split('\r\n')).toHaveLength(4);
    expect(csv).not.toContain('private');
  });
  it('keeps domains without listings exact across normal SQL-sort paths and export', async () => {
    const summary = await dashboard(ctx());
    for (const sort of ['name', 'comparison', 'registrar']) {
      const result = await listDomains(
        ctx(),
        new URLSearchParams(`listing=none&status=active&sort=${sort}`),
      );
      expect(result.total).toBe(summary.missing);
      expect(result.rows.map((r) => r.name)).toEqual(['missing.test']);
    }
    const exported = await exportPortfolio(
      new Request('http://localhost/api/export?listing=none&status=active'),
    );
    const csv = await exported.text();
    expect(csv.trim().split('\r\n')).toHaveLength(2);
    expect(csv).toContain('missing.test');
    expect(csv).not.toContain('private');
  });
  it('includes recorded registrars beyond the first ten without including other workspaces', async () => {
    const domain = await db.domain.findFirstOrThrow({ where: { organizationId: orgId } });
    const foreignDomain = await db.domain.findFirstOrThrow({ where: { organizationId: otherId } });
    const registrars = Array.from({ length: 12 }, (_, i) => `Fixture registrar ${i}`);
    await db.domainRegistration.createMany({
      data: [
        ...registrars.map((registrar) => ({ domainId: domain.id, registrar, source: 'fixture' })),
        { domainId: foreignDomain.id, registrar: 'Foreign fixture registrar', source: 'fixture' },
      ],
    });
    const names = (await dashboard(ctx())).registrars.map((group) => group.registrar);
    expect(names).toEqual(expect.arrayContaining(registrars));
    expect(names).not.toContain('Foreign fixture registrar');
  });
});
