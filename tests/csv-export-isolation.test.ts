import 'dotenv/config';
import Papa from 'papaparse';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const fixture = vi.hoisted(() => ({ organizationId: '', userId: '', sessionId: '' }));
vi.mock('../src/lib/access', () => ({
  context: async () => ({ org: { id: fixture.organizationId }, user: { id: fixture.userId } }),
}));
vi.mock('../src/auth', () => ({
  auth: async () => ({ user: { id: fixture.userId }, loginSessionId: fixture.sessionId }),
}));
import { GET as finance } from '../src/app/api/finance-export/route';
import { GET as portfolio } from '../src/app/api/export/route';
import { requireExportMembership } from '../src/lib/csv-stream';

describe.skipIf(!process.env.TEST_DATABASE_URL)('account-scoped CSV exports', () => {
  let orgId = '',
    otherId = '';
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    orgId = (await db.organization.create({ data: { name: 'Export A' } })).id;
    otherId = (await db.organization.create({ data: { name: 'Export B' } })).id;
    fixture.organizationId = orgId;
    fixture.userId = (await db.user.create({ data: { email: `${randomUUID()}@example.test` } })).id;
    fixture.sessionId = randomUUID();
    await db.accountLoginSession.create({
      data: {
        id: fixture.sessionId,
        userId: fixture.userId,
        sessionVersion: 0,
        method: 'credentials',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await db.organizationMember.create({
      data: { organizationId: orgId, userId: fixture.userId, role: 'VIEWER' },
    });
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'export.test',
        unicodeName: 'export.test',
        tld: 'test',
        acquisitionCost: '20',
        registrations: { create: { registrar: '=unsafe', currency: 'USD', nameservers: [] } },
        expenses: { create: { category: 'cost', amount: '5', currency: 'USD' } },
        sales: {
          create: {
            marketplace: 'Market',
            grossAmount: '100',
            currency: 'USD',
            status: 'completed',
            payments: {
              create: {
                amount: '90',
                commissionWithheld: '10',
                currency: 'USD',
                reference: 'receipt',
              },
            },
            commissions: { create: { amount: '10', currency: 'USD' } },
            adjustments: { create: { amount: '2', currency: 'USD', reason: 'test' } },
          },
        },
      },
    });
    await db.domain.create({
      data: {
        organizationId: otherId,
        name: 'private.test',
        unicodeName: 'private.test',
        tld: 'test',
        sales: { create: { marketplace: 'Other', grossAmount: '999', currency: 'USD' } },
      },
    });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherId] } } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
    await db.$disconnect();
  });
  it('streams formula-safe portfolio records only from the selected workspace', async () => {
    const response = await portfolio(new Request('http://localhost/api/export'));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.text();
    expect(body).toContain('export.test');
    expect(body).toContain("'=unsafe");
    expect(body).not.toContain('private.test');
  });
  it('aggregates finance records without disclosing another workspace', async () => {
    const response = await finance();
    const body = await response.text();
    expect(body).not.toContain('private.test');
    const rows = Papa.parse<Record<string, string>>(body, {
      header: true,
      skipEmptyLines: true,
    }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: 'export.test',
      collected: '90.00',
      commissionWithheld: '10.00',
      grossSettled: '100.00',
      unpaid: '0.00',
      commission: '10.00',
      netProceeds: '90.00',
      realizedProfit: '67.00',
    });
  });
  it('exports all comparison-filtered pages without crossing workspaces', async () => {
    await db.domain.createMany({
      data: Array.from({ length: 510 }, (_, i) => ({
        organizationId: orgId,
        name: `batch-${i}.test`,
        unicodeName: `batch-${i}.test`,
        tld: 'test',
        status: 'active',
      })),
    });
    const response = await portfolio(
      new Request('http://localhost/api/export?matrix=true&comparison=insufficient&sort=askingPrice'),
    );
    const rows = Papa.parse<Record<string, string>>(await response.text(), {
      header: true,
      skipEmptyLines: true,
    }).data;
    expect(rows.filter((row) => row.domain.startsWith('batch-'))).toHaveLength(510);
    expect(new Set(rows.map((row) => row.domain)).size).toBe(rows.length);
    expect(rows.some((row) => row.domain === 'private.test')).toBe(false);
  });
  it('stops future page reads after workspace membership is revoked', async () => {
    await expect(
      requireExportMembership(orgId, fixture.userId, fixture.sessionId),
    ).resolves.toBeUndefined();
    await db.organizationMember.deleteMany({
      where: { organizationId: orgId, userId: fixture.userId },
    });
    await expect(requireExportMembership(orgId, fixture.userId, fixture.sessionId)).rejects.toThrow(
      'access changed',
    );
    await db.organizationMember.create({
      data: { organizationId: orgId, userId: fixture.userId, role: 'VIEWER' },
    });
    await db.accountLoginSession.delete({ where: { id: fixture.sessionId } });
    await expect(requireExportMembership(orgId, fixture.userId, fixture.sessionId)).rejects.toThrow(
      'access changed',
    );
  });
});
