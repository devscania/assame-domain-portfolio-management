import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Context } from '@/lib/access';
import { db } from '@/lib/db';
import {
  queuePublicRegistration,
  publicRegistrationStatus,
  runPublicRegistration,
} from '@/lib/public-registration-jobs';
import { lookupRegistration } from '@/lib/rdap';

vi.mock('@/lib/rdap', () => ({ lookupRegistration: vi.fn() }));

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
