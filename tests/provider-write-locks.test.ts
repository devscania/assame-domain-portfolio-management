import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import * as prices from '../src/integrations/prices';
import * as actions from '../src/integrations/actions';
import { db } from '../src/lib/db';
import { encrypt } from '../src/lib/security';
import { runListingPriceJob } from '../src/lib/listing-prices';
import { runProviderChange } from '../src/lib/provider-changes';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'provider write authorization under concurrent changes',
  () => {
    let ownerId = '',
      orgId = '',
      accountId = '',
      domainId = '',
      listingId = '';
    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
        throw new Error('A dedicated test database is required');
      vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32));
      const owner = await db.user.create({
        data: {
          email: `provider-lock-${randomUUID()}@example.test`,
        },
      });
      ownerId = owner.id;
      const org = await db.organization.create({
        data: {
          name: 'Provider lock test',
          workspaceOwnerId: ownerId,
          pricePublishingEnabled: true,
          providerActionsEnabled: true,
          members: { create: { userId: ownerId, role: 'OWNER' } },
        },
      });
      orgId = org.id;
      await db.provider.upsert({
        where: { id: 'spaceship' },
        create: { id: 'spaceship', name: 'Spaceship', kind: 'both' },
        update: {},
      });
      const account = await db.providerAccount.create({
        data: {
          organizationId: orgId,
          providerId: 'spaceship',
          label: randomUUID(),
          credential: { create: { ciphertext: encrypt({ apiKey: 'test', apiSecret: 'test' }) } },
        },
      });
      accountId = account.id;
      const domain = await db.domain.create({
        data: {
          organizationId: orgId,
          name: 'provider-lock.test',
          unicodeName: 'provider-lock.test',
          tld: 'test',
          listings: {
            create: { marketplace: 'spaceship', providerAccountId: accountId, binPrice: '100' },
          },
        },
        include: { listings: true },
      });
      domainId = domain.id;
      listingId = domain.listings[0].id;
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await db.organization.deleteMany({ where: { id: orgId } });
      await db.user.deleteMany({ where: { id: ownerId } });
      await db.$disconnect();
    });
    it.each(['price', 'action'] as const)(
      'holds account and workspace locks across a %s provider write',
      async (kind) => {
        let start!: () => void;
        let finish!: () => void;
        const started = new Promise<void>((resolve) => {
          start = resolve;
        });
        const release = new Promise<void>((resolve) => {
          finish = resolve;
        });
        let remoteChanged = false;
        const write = vi.fn(async () => {
          start();
          await release;
          remoteChanged = true;
        });
        const priceSpy = vi.spyOn(prices, 'priceClient').mockReturnValue({
          read: async () => ({
            name: 'provider-lock.test',
            price: remoteChanged ? '200' : '100',
            currency: 'USD',
            status: 'active',
          }),
          update: write,
        });
        const actionSpy = vi.spyOn(actions, 'actionClient').mockReturnValue({
          removeListing: vi.fn(),
          nameservers: vi.fn(),
          setNameservers: vi.fn(),
          listing: async () =>
            remoteChanged
              ? { name: 'provider-lock.test', price: '200', currency: 'USD', status: 'active' }
              : null,
          addListing: write,
        });
        const job = await db.syncJob.create({
          data: {
            providerAccountId: accountId,
            kind: kind === 'price' ? 'price' : 'providerChange',
          },
        });
        const change =
          kind === 'price'
            ? await db.listingPriceChange.create({
                data: {
                  organizationId: orgId,
                  providerAccountId: accountId,
                  listingId,
                  requestedBy: ownerId,
                  oldPrice: '100',
                  newPrice: '200',
                  currency: 'USD',
                  remoteStatus: 'active',
                  expiresAt: new Date(Date.now() + 60000),
                  status: 'queued',
                  syncJobId: job.id,
                },
              })
            : await db.providerChange.create({
                data: {
                  organizationId: orgId,
                  providerAccountId: accountId,
                  domainId,
                  requestedBy: ownerId,
                  action: 'addListing',
                  input: {
                    action: 'addListing',
                    domainId,
                    accountId,
                    price: '200',
                    currency: 'USD',
                  },
                  snapshot: Prisma.JsonNull,
                  expiresAt: new Date(Date.now() + 60000),
                  status: 'queued',
                  syncJobId: job.id,
                },
              });
        const worker = kind === 'price' ? runListingPriceJob(job.id) : runProviderChange(job.id);
        try {
          await started;
          await expect(
            db.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE NOWAIT`,
          ).rejects.toThrow();
          await expect(
            db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE NOWAIT`,
          ).rejects.toThrow();
          const persisted =
            kind === 'price'
              ? await db.listingPriceChange.findUniqueOrThrow({ where: { id: change.id } })
              : await db.providerChange.findUniqueOrThrow({ where: { id: change.id } });
          expect(persisted.status).toBe('executing');
        } finally {
          finish();
          await worker;
          priceSpy.mockRestore();
          actionSpy.mockRestore();
        }
        expect(write).toHaveBeenCalledTimes(1);
        expect((await db.syncJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
          'completed',
        );
      },
      15000,
    );
    it('refuses a price write when permission changes after the provider read', async () => {
      let begin!: () => void;
      let finish!: () => void;
      const started = new Promise<void>((resolve) => {
        begin = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const write = vi.fn(async () => {});
      const spy = vi.spyOn(prices, 'priceClient').mockReturnValue({
        read: async () => {
          begin();
          await release;
          return { name: 'provider-lock.test', price: '100', currency: 'USD', status: 'active' };
        },
        update: write,
      });
      const job = await db.syncJob.create({
        data: { providerAccountId: accountId, kind: 'price' },
      });
      const change = await db.listingPriceChange.create({
        data: {
          organizationId: orgId,
          providerAccountId: accountId,
          listingId,
          requestedBy: ownerId,
          oldPrice: '100',
          newPrice: '300',
          currency: 'USD',
          remoteStatus: 'active',
          expiresAt: new Date(Date.now() + 60000),
          status: 'queued',
          syncJobId: job.id,
        },
      });
      const worker = runListingPriceJob(job.id);
      try {
        await started;
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
          await tx.organizationMember.update({
            where: { organizationId_userId: { organizationId: orgId, userId: ownerId } },
            data: { role: 'VIEWER' },
          });
        });
      } finally {
        finish();
        await worker;
        spy.mockRestore();
        await db.organizationMember.update({
          where: { organizationId_userId: { organizationId: orgId, userId: ownerId } },
          data: { role: 'OWNER' },
        });
      }
      expect(write).not.toHaveBeenCalled();
      expect(
        (await db.listingPriceChange.findUniqueOrThrow({ where: { id: change.id } })).status,
      ).toBe('failed');
    }, 15000);
  },
);
