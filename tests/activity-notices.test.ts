import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { isLoopbackFixtureDatabase } from '../scripts/synthetic-database';
import { db } from '@/lib/db';
import { sendActivityEmail } from '@/lib/auth-email';
import { queueActivityNotice, sendOneActivityNotice } from '@/lib/activity-notices';
import { allowsActivityEmail } from '@/lib/activity-email-policy';
import { refreshPendingAfternicListings } from '@/lib/pending-marketplace-listings';
import { encrypt } from '@/lib/security';
import type { Context } from '@/lib/access';
import { audit } from '@/lib/portfolio';
import { workspaceActivity } from '@/lib/workspace-activity';

const { readListing } = vi.hoisted(() => ({ readListing: vi.fn() }));
vi.mock('@/integrations/actions', () => ({ actionClient: () => ({ listing: readListing }) }));
vi.mock('@/lib/auth-email', () => ({
  emailConfigured: () => true,
  sendActivityEmail: vi.fn(),
}));
it('applies email switches independently and keeps existing opt-ins enabled by default', () => {
  const preferences = {
    activityBulkEmails: false,
    activityPriceEmails: true,
    activitySyncEmails: false,
  };
  expect(allowsActivityEmail(preferences, 'bulk')).toBe(false);
  expect(allowsActivityEmail(preferences, 'price')).toBe(true);
  expect(allowsActivityEmail(preferences, 'sync')).toBe(false);
  expect(allowsActivityEmail(preferences, 'other')).toBe(true);
  expect(allowsActivityEmail(undefined, 'bulk')).toBe(true);
});

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'deduplicates delivery and rechecks opt-ins across workspaces',
  async () => {
    const testDatabase = process.env.TEST_DATABASE_URL;
    if (
      !testDatabase ||
      process.env.DATABASE_URL !== testDatabase ||
      !isLoopbackFixtureDatabase(testDatabase)
    )
      throw new Error('Disposable fixture database required');
    const owner = await db.user.create({
      data: {
        email: `delist-${randomUUID()}@example.test`,
        emailVerified: new Date(),
        preference: { create: { activityEmails: true } },
      },
    });
    try {
      async function workspace(name: string) {
        const org = await db.organization.create({
          data: {
            name,
            workspaceOwnerId: owner.id,
            members: { create: { role: 'OWNER', userId: owner.id } },
          },
        });
        const account = await db.providerAccount.create({
          data: { organizationId: org.id, label: name, providerId: 'afternic' },
        });
        const domainName = `${name}.test`;
        const domain = await db.domain.create({
          data: { organizationId: org.id, name: domainName, unicodeName: domainName, tld: 'test' },
        });
        return {
          organizationId: org.id,
          domainId: domain.id,
          providerAccountId: account.id,
          requestedBy: owner.id,
          action: 'removeListing',
          status: 'completed',
          input: {},
          snapshot: {},
          expiresAt: new Date(),
        };
      }
      const [first, second] = await Promise.all([workspace('first'), workspace('second')]);
      const queued = await db.providerChange.create({ data: first });
      const next = await db.providerChange.create({ data: second });
      const event = (change: typeof queued) => ({
        eventId: change.id,
        organizationId: change.organizationId,
        recipientId: owner.id,
        category: 'other' as const,
        title: change.id === queued.id ? 'Marketplace listing added' : 'Payout recorded',
        message: 'Activity fixture.',
      });
      await db.$transaction(async (tx) => {
        await queueActivityNotice(tx, event(queued));
        await queueActivityNotice(tx, event(queued));
        await queueActivityNotice(tx, event(next));
      });
      await Promise.all([sendOneActivityNotice(), sendOneActivityNotice()]);
      expect(sendActivityEmail).toHaveBeenCalledTimes(2);
      expect(sendActivityEmail).toHaveBeenCalledWith(
        owner.email,
        expect.stringMatching(/Marketplace listing added|Payout recorded/),
        'Activity fixture.',
      );
      const notices = await db.activityNotice.findMany({
        where: { eventId: { in: [queued.id, next.id] } },
        orderBy: { status: 'asc' },
      });
      expect(notices.map(({ status }) => status)).toEqual(['sent', 'sent']);
      const optOut = await db.providerChange.create({ data: first });
      await db.$transaction((tx) => queueActivityNotice(tx, event(optOut)));
      await db.userPreference.update({
        where: { userId: owner.id },
        data: { activityEmails: false },
      });
      await sendOneActivityNotice();
      expect(await db.activityNotice.findUnique({ where: { eventId: optOut.id } })).toMatchObject({
        status: 'skipped',
      });
      expect(sendActivityEmail).toHaveBeenCalledTimes(2);

      await db.userPreference.update({
        where: { userId: owner.id },
        data: { activityEmails: true },
      });
      const org = await db.organization.findUniqueOrThrow({ where: { id: first.organizationId } });
      const ctx = { org, user: { id: owner.id } } as Context;
      await db.$transaction(async (tx) => {
        await audit(tx, ctx, 'domain.updated', first.domainId);
        for (const id of [first.domainId, second.domainId])
          await audit(tx, ctx, 'domain.acquisition_cost_updated', id, { source: 'manual-bulk' });
        await audit(tx, ctx, 'bulk.acquisitionCost_updated', undefined, {
          count: 6,
          domains: ['one.test', 'two.test', 'three.test'],
          value: '12.50',
        });
      });
      const activity = await workspaceActivity(org.id, 10);
      expect(activity).toHaveLength(2);
      expect(activity).toContainEqual(
        expect.objectContaining({
          label: 'Bulk acquisition costs updated · 6 domains',
          description: 'one.test, two.test, three.test and 3 more',
        }),
      );
      expect(
        await db.activityNotice.findMany({
          where: { organizationId: org.id, status: 'pending' },
          select: { title: true, message: true },
        }),
      ).toEqual([
        {
          title: 'Bulk acquisition costs updated',
          message:
            'Bulk acquisition costs updated · 6 domains in first. Affected domains include one.test, two.test, three.test and 3 more.',
        },
      ]);
    } finally {
      await db.organization.deleteMany({ where: { workspaceOwnerId: owner.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'keeps pending listings pending until a fresh read reports active, then queues one update',
  async () => {
    const testDatabase = process.env.TEST_DATABASE_URL;
    if (
      !testDatabase ||
      process.env.DATABASE_URL !== testDatabase ||
      !isLoopbackFixtureDatabase(testDatabase)
    )
      throw new Error('Disposable fixture database required');
    const owner = await db.user.create({
      data: {
        email: `listing-${randomUUID()}@example.test`,
        emailVerified: new Date(),
        preference: { create: { activityEmails: true } },
      },
    });
    try {
      const org = await db.organization.create({
        data: {
          name: 'Pending listing fixture',
          workspaceOwnerId: owner.id,
          members: { create: { role: 'OWNER', userId: owner.id } },
        },
      });
      const account = await db.providerAccount.create({
        data: {
          organizationId: org.id,
          label: 'Afternic fixture',
          providerId: 'afternic',
          status: 'connected',
          credential: {
            create: { ciphertext: encrypt({ apiKey: 'fixture', apiSecret: 'fixture' }) },
          },
        },
      });
      const name = 'pending-listing.test';
      const domain = await db.domain.create({
        data: { organizationId: org.id, name, unicodeName: name, tld: 'test' },
      });
      const listing = await db.domainListing.create({
        data: {
          domainId: domain.id,
          providerAccountId: account.id,
          marketplace: 'afternic',
          source: 'afternic',
          status: 'PENDING',
          verifiedAt: new Date(Date.now() - 600000),
        },
      });
      const change = await db.providerChange.create({
        data: {
          organizationId: org.id,
          domainId: domain.id,
          providerAccountId: account.id,
          requestedBy: owner.id,
          action: 'addListing',
          status: 'completed',
          input: {},
          snapshot: {},
          expiresAt: new Date(),
          finishedAt: new Date(),
        },
      });
      const eventId = `listing-active:${change.id}`;
      readListing.mockResolvedValueOnce({ name, status: 'PENDING' });
      await refreshPendingAfternicListings();
      expect(await db.domainListing.findUnique({ where: { id: listing.id } })).toMatchObject({
        status: 'PENDING',
      });
      expect(await db.activityNotice.findUnique({ where: { eventId } })).toBeNull();
      readListing.mockResolvedValueOnce({ name, status: 'ACTIVE' });
      await refreshPendingAfternicListings(new Date(Date.now() + 660000));
      expect(await db.domainListing.findUnique({ where: { id: listing.id } })).toMatchObject({
        status: 'ACTIVE',
      });
      expect(await db.activityNotice.findUnique({ where: { eventId } })).toMatchObject({
        recipientId: owner.id,
        title: 'Afternic listing active',
      });
    } finally {
      await db.organization.deleteMany({ where: { workspaceOwnerId: owner.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  },
);
