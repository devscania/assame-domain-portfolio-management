import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Context } from '@/lib/access';
import { db } from '@/lib/db';
import {
  queuePublicRegistration,
  publicRegistrationStatus,
  runPublicRegistration,
} from '@/lib/public-registration-jobs';
import { lookupRegistration } from '@/lib/rdap';
import { lookupPublicNameservers } from '@/lib/public-nameservers';
import { isLoopbackFixtureDatabase } from '../scripts/synthetic-database';

vi.mock('@/lib/rdap', () => ({ lookupRegistration: vi.fn() }));
vi.mock('@/lib/public-nameservers', () => ({ lookupPublicNameservers: vi.fn() }));
beforeEach(() => {
  if (
    process.env.TEST_DATABASE_URL &&
    (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
      !isLoopbackFixtureDatabase(process.env.TEST_DATABASE_URL))
  )
    throw new Error('Dedicated loopback test database required');
  vi.mocked(lookupRegistration).mockReset().mockResolvedValue(null);
  vi.mocked(lookupPublicNameservers).mockReset().mockResolvedValue([]);
});

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'fills missing fields while preserving verified data and workspace boundaries',
  async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    const owner = await db.user.create({
      data: { email: `rdap-${randomUUID()}@example.test` },
    });
    const workspace = await db.organization.create({
      data: {
        name: 'RDAP fixture',
        workspaceOwnerId: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const foreign = await db.organization.create({ data: { name: 'Other workspace' } });
    try {
      const createDomain = (name: string, organizationId = workspace.id) =>
        db.domain.create({ data: { name, unicodeName: name, tld: 'test', organizationId } });
      const target = await createDomain('public-fixture.test');
      const verified = await createDomain('verified-fixture.test');
      const outside = await createDomain('foreign-fixture.test', foreign.id);
      for (let i = 0; i < 19; i++) await createDomain(`unavailable-${i}.test`);
      await db.domainRegistration.createMany({
        data: [
          { domainId: target.id, registrar: 'Unknown', nameservers: [], source: 'manual' },
          {
            domainId: verified.id,
            registrar: 'Namecheap',
            nameservers: [],
            source: 'namecheap',
            verifiedAt: new Date(),
          },
        ],
      });
      const expiry = new Date('2028-01-01T00:00:00Z');
      vi.mocked(lookupRegistration).mockImplementation(async (name) =>
        name.startsWith('unavailable-')
          ? null
          : {
              registrar: 'NameCheap, Inc.',
              expiresAt: expiry,
              registeredAt: undefined,
              nameservers: [],
            },
      );
      const ctx = { user: { id: owner.id }, org: workspace, role: 'OWNER' } as Context;
      expect(await queuePublicRegistration(ctx)).toEqual({ queued: true });
      expect(await queuePublicRegistration(ctx)).toEqual({ queued: false });
      expect(lookupRegistration).not.toHaveBeenCalled();
      await runPublicRegistration(workspace.id);
      expect(await publicRegistrationStatus(workspace.id)).toMatchObject({ status: 'queued' });
      await runPublicRegistration(workspace.id);
      expect(await publicRegistrationStatus(workspace.id)).toMatchObject({
        status: 'completed',
        updated: 1,
        unavailable: 19,
        unchanged: 1,
      });
      expect(await publicRegistrationStatus(foreign.id)).toBeNull();
      expect(
        await db.domainRegistration.findMany({ where: { domainId: target.id } }),
      ).toMatchObject([
        {
          registrar: 'Namecheap',
          source: 'public-rdap',
          expiresAt: expiry,
          providerAccountId: null,
          verifiedAt: null,
        },
      ]);
      expect(
        (await db.domainRegistration.findFirstOrThrow({ where: { domainId: verified.id } }))
          .expiresAt,
      ).toBeNull();
      expect(lookupRegistration).not.toHaveBeenCalledWith(outside.name);
    } finally {
      await db.organization.deleteMany({ where: { id: { in: [workspace.id, foreign.id] } } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'fills nameservers on provider-linked registrations with complete dates without replacing provider evidence',
  async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    const owner = await db.user.create({ data: { email: `ns-${randomUUID()}@example.test` } });
    const org = await db.organization.create({
      data: {
        name: 'Nameserver fixture',
        workspaceOwnerId: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    try {
      await db.provider.upsert({
        where: { id: 'namecheap' },
        create: { id: 'namecheap', name: 'Namecheap', kind: 'registrar' },
        update: {},
      });
      const account = await db.providerAccount.create({
        data: { organizationId: org.id, providerId: 'namecheap', label: 'Fixture' },
      });
      const expiry = new Date('2028-01-01');
      const verifiedAt = new Date('2026-01-01');
      const target = await db.domain.create({
        data: {
          organizationId: org.id,
          name: 'missing-ns.test',
          unicodeName: 'missing-ns.test',
          tld: 'test',
          registrations: {
            create: {
              registrar: 'Namecheap',
              providerAccountId: account.id,
              source: 'namecheap',
              verifiedAt,
              expiresAt: expiry,
              nameservers: [],
              renewalCost: '12.34',
              autoRenew: true,
            },
          },
        },
        include: { registrations: true },
      });
      const complete = await db.domain.create({
        data: {
          organizationId: org.id,
          name: 'existing-ns.test',
          unicodeName: 'existing-ns.test',
          tld: 'test',
          registrations: {
            create: {
              registrar: 'Namecheap',
              source: 'namecheap',
              verifiedAt,
              expiresAt: expiry,
              nameservers: ['keep.example.test'],
            },
          },
        },
      });
      vi.mocked(lookupPublicNameservers).mockResolvedValue([
        'ns1.example.test',
        'ns2.example.test',
      ]);
      const ctx = { user: { id: owner.id }, org, role: 'OWNER' } as Context;
      await queuePublicRegistration(ctx);
      await runPublicRegistration(org.id);
      expect(await publicRegistrationStatus(org.id)).toMatchObject({
        status: 'completed',
        updated: 1,
        unavailable: 0,
      });
      const row = await db.domainRegistration.findFirstOrThrow({ where: { domainId: target.id } });
      expect(row).toMatchObject({
        nameservers: ['ns1.example.test', 'ns2.example.test'],
        providerAccountId: account.id,
        source: 'namecheap',
        verifiedAt,
        expiresAt: expiry,
        autoRenew: true,
      });
      expect(row.renewalCost?.toString()).toBe('12.34');
      expect(lookupRegistration).not.toHaveBeenCalled();
      expect(lookupPublicNameservers).not.toHaveBeenCalledWith(complete.name);
      await queuePublicRegistration(ctx);
      await runPublicRegistration(org.id);
      expect(await publicRegistrationStatus(org.id)).toMatchObject({
        updated: 0,
        unchanged: 0,
        unavailable: 0,
      });
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'uses RDAP nameservers when DNS is unavailable and keeps a newer provider observation',
  async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    const owner = await db.user.create({
      data: { email: `ns-fallback-${randomUUID()}@example.test` },
    });
    const org = await db.organization.create({
      data: {
        name: 'Fallback fixture',
        workspaceOwnerId: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    try {
      const target = await db.domain.create({
        data: {
          organizationId: org.id,
          name: 'fallback-ns.test',
          unicodeName: 'fallback-ns.test',
          tld: 'test',
          registrations: {
            create: {
              registrar: 'Namecheap',
              source: 'namecheap',
              verifiedAt: new Date(),
              expiresAt: new Date('2028-01-01'),
              nameservers: [],
            },
          },
        },
        include: { registrations: true },
      });
      vi.mocked(lookupRegistration).mockResolvedValue({
        registrar: 'NameCheap, Inc.',
        expiresAt: new Date('2030-01-01'),
        registeredAt: undefined,
        nameservers: ['rdap.example.test'],
      });
      const ctx = { user: { id: owner.id }, org, role: 'OWNER' } as Context;
      await queuePublicRegistration(ctx);
      await runPublicRegistration(org.id);
      expect(await publicRegistrationStatus(org.id)).toMatchObject({ updated: 1 });
      const row = await db.domainRegistration.findFirstOrThrow({ where: { domainId: target.id } });
      expect(row.nameservers).toEqual(['rdap.example.test']);
      expect(row.expiresAt).toEqual(new Date('2028-01-01'));
      await db.domainRegistration.update({ where: { id: row.id }, data: { nameservers: [] } });
      vi.mocked(lookupPublicNameservers).mockImplementation(async () => {
        await db.domainRegistration.update({
          where: { id: row.id },
          data: { nameservers: ['new-provider.example.test'] },
        });
        return ['stale-public.example.test'];
      });
      await queuePublicRegistration(ctx);
      await runPublicRegistration(org.id);
      expect(await publicRegistrationStatus(org.id)).toMatchObject({ updated: 0, unchanged: 1 });
      expect(
        (await db.domainRegistration.findUniqueOrThrow({ where: { id: row.id } })).nameservers,
      ).toEqual(['new-provider.example.test']);
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'records DNS-only nameservers when a registry offers no registration metadata',
  async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    const owner = await db.user.create({
      data: { email: `dns-only-${randomUUID()}@example.test` },
    });
    const org = await db.organization.create({
      data: {
        name: 'DNS only fixture',
        workspaceOwnerId: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    try {
      const target = await db.domain.create({
        data: {
          organizationId: org.id,
          name: 'dns-only.test',
          unicodeName: 'dns-only.test',
          tld: 'test',
        },
      });
      vi.mocked(lookupPublicNameservers).mockResolvedValue(['ns1.example.test']);
      const ctx = { user: { id: owner.id }, org, role: 'OWNER' } as Context;
      await queuePublicRegistration(ctx);
      await runPublicRegistration(org.id);
      expect(await publicRegistrationStatus(org.id)).toMatchObject({ updated: 1 });
      expect(
        await db.domainRegistration.findFirstOrThrow({ where: { domainId: target.id } }),
      ).toMatchObject({
        registrar: 'Unknown',
        source: 'public-dns',
        nameservers: ['ns1.example.test'],
        providerAccountId: null,
        verifiedAt: null,
        expiresAt: null,
      });
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);
