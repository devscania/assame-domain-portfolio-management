import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as actions from '../src/integrations/actions';
import { db } from '../src/lib/db';
import { encrypt } from '../src/lib/security';
import { runProviderChange } from '../src/lib/provider-changes';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Dynadot removal safeguards', () => {
  it('requires the verified registrar connection before sending and deletes local listing only after confirmed absence', async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32));
    const user = await db.user.create({
      data: {
        email: `dynadot-remove-${randomUUID()}@example.test`,
      },
    });
    let orgId = '';
    try {
      const org = await db.organization.create({
        data: {
          name: 'Dynadot removal',
          workspaceOwnerId: user.id,
          providerActionsEnabled: true,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      orgId = org.id;
      await db.provider.upsert({
        where: { id: 'dynadot' },
        create: { id: 'dynadot', name: 'Dynadot', kind: 'both' },
        update: {},
      });
      const account = await db.providerAccount.create({
        data: {
          organizationId: org.id,
          providerId: 'dynadot',
          label: randomUUID(),
          credential: { create: { ciphertext: encrypt({ apiKey: 'test' }) } },
        },
      });
      const domain = await db.domain.create({
        data: {
          organizationId: org.id,
          name: 'dynadot-fixture.test',
          unicodeName: 'dynadot-fixture.test',
          tld: 'test',
          listings: { create: { marketplace: 'dynadot', providerAccountId: account.id } },
        },
      });
      const snapshot = {
        name: domain.name,
        price: '100.00',
        currency: 'USD',
        status: 'listed',
        listingId: '1',
        listingType: 'bin',
      };
      let remote: typeof snapshot | null = snapshot;
      const remove = vi.fn(async () => {
        remote = null;
      });
      const spy = vi.spyOn(actions, 'actionClient').mockReturnValue({
        removeListing: remove,
        listing: async () => remote,
        nameservers: vi.fn(),
        setNameservers: vi.fn(),
        addListing: vi.fn(),
      });
      const createChange = async () => {
        const job = await db.syncJob.create({
          data: { providerAccountId: account.id, kind: 'providerChange' },
        });
        const change = await db.providerChange.create({
          data: {
            organizationId: org.id,
            providerAccountId: account.id,
            domainId: domain.id,
            requestedBy: user.id,
            action: 'removeListing',
            input: { action: 'removeListing', domainId: domain.id, accountId: account.id },
            snapshot,
            status: 'queued',
            syncJobId: job.id,
            expiresAt: new Date(Date.now() + 60000),
            createdAt: new Date(Date.now() + 1000),
          },
        });
        return { job, change };
      };
      const blocked = await createChange();
      await runProviderChange(blocked.job.id);
      expect(remove).not.toHaveBeenCalled();
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: blocked.change.id } })).status,
      ).toBe('failed');
      expect(
        await db.domainListing.count({ where: { domainId: domain.id, marketplace: 'dynadot' } }),
      ).toBe(1);
      await db.domainRegistration.create({
        data: {
          domainId: domain.id,
          providerAccountId: account.id,
          registrar: 'Dynadot',
          source: 'dynadot',
          verifiedAt: new Date(),
          nameservers: [],
        },
      });
      const confirmed = await createChange();
      await runProviderChange(confirmed.job.id);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: confirmed.change.id } })).status,
      ).toBe('completed');
      expect(
        await db.domainListing.count({ where: { domainId: domain.id, marketplace: 'dynadot' } }),
      ).toBe(0);
      spy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await db.organization.deleteMany({ where: { id: orgId } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  });
});
