import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { importCsv } from '../src/lib/portfolio';
import type { Context } from '../src/lib/access';

describe.skipIf(!process.env.TEST_DATABASE_URL)('batch CSV import', () => {
  let ownerId = '',
    orgId = '';
  let ctx: Context;
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
      },
    });
    ownerId = user.id;
    const org = await db.organization.create({
      data: {
        name: 'CSV batch',
        workspaceOwnerId: ownerId,
        members: { create: { userId: ownerId, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    ctx = {
      user: { id: ownerId, email: user.email },
      org,
      role: 'OWNER',
      members: [],
    } as unknown as Context;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });
  it('imports multiple batches atomically with registrations, tags and price history', async () => {
    const csv = [
      'name,registrar,price,tags',
      ...Array.from({ length: 501 }, (_, i) => `batch-${i}.test,Example,100.00,group;shared`),
    ].join('\n');
    const request = {
      csv,
      mapping: { name: 'name', registrar: 'registrar', askingPrice: 'price', tags: 'tags' },
      overwrite: false,
    };
    expect(await db.domain.count({ where: { organizationId: orgId } })).toBe(0);

    expect(await importCsv(ctx, request, true)).toMatchObject({
      inserts: 501,
      valid: 501,
      confirmed: true,
    });
    expect(await db.domain.count({ where: { organizationId: orgId } })).toBe(501);
    expect(
      await db.domainRegistration.count({ where: { domain: { organizationId: orgId } } }),
    ).toBe(501);
    expect(
      await db.domainPriceHistory.count({ where: { domain: { organizationId: orgId } } }),
    ).toBe(501);
    expect(
      await db.domainTagAssignment.count({ where: { domain: { organizationId: orgId } } }),
    ).toBe(1002);
    expect(await importCsv(ctx, request, true)).toMatchObject({ inserts: 0, skipped: 501 });
    expect(await db.domain.count({ where: { organizationId: orgId } })).toBe(501);
  });
  it('returns committed counts when concurrent imports contain the same domain', async () => {
    const request = { csv: 'name\nrace.test', mapping: { name: 'name' }, overwrite: false };
    const results = await Promise.all([
      importCsv(ctx, request, true),
      importCsv(ctx, request, true),
    ]);
    expect(results.map((result) => result.inserts).sort()).toEqual([0, 1]);
    expect(results.map((result) => result.skipped).sort()).toEqual([0, 1]);
    expect(await db.domain.count({ where: { organizationId: orgId, name: 'race.test' } })).toBe(1);
  });
});
