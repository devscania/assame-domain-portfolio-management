import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as actions from '../src/integrations/actions';
import { db } from '../src/lib/db';
import { encrypt } from '../src/lib/security';
import { runProviderChange } from '../src/lib/provider-changes';

describe.skipIf(!process.env.TEST_DATABASE_URL)('confirmed provider change verification', () => {
  let ownerId = '',
    orgId = '',
    domainId = '',
    sellerId = '',
    afternicId = '',
    registrarId = '';
  const domainName = 'provider-verification.test';
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32));
    const owner = await db.user.create({
      data: {
        email: `provider-verify-${randomUUID()}@example.test`,
      },
    });
    ownerId = owner.id;
    const org = await db.organization.create({
      data: {
        name: 'Provider verification',
        workspaceOwnerId: ownerId,
        providerActionsEnabled: true,
        members: { create: { userId: ownerId, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    for (const [id, name] of [
      ['spaceship', 'Spaceship'],
      ['namecheap', 'Namecheap'],
      ['afternic', 'Afternic'],
    ])
      await db.provider.upsert({ where: { id }, create: { id, name, kind: 'both' }, update: {} });
    const createAccount = (providerId: string) =>
      db.providerAccount.create({
        data: {
          organizationId: orgId,
          providerId,
          status: 'connected',
          label: randomUUID(),
          credential: { create: { ciphertext: encrypt({ apiKey: 'test', apiSecret: 'test' }) } },
        },
      });
    sellerId = (await createAccount('spaceship')).id;
    afternicId = (await createAccount('afternic')).id;
    registrarId = (await createAccount('namecheap')).id;
    const domain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: domainName,
        unicodeName: domainName,
        tld: 'test',
        listings: {
          create: { marketplace: 'spaceship', providerAccountId: sellerId, binPrice: '100' },
        },
      },
    });
    domainId = domain.id;
    await db.domainRegistration.create({
      data: {
        domainId,
        providerAccountId: registrarId,
        registrar: 'Namecheap',
        source: 'namecheap',
        verifiedAt: new Date(),
        nameservers: ['ns1.old.test', 'ns2.old.test'],
      },
    });
  });
  it('verifies an Afternic removal before deleting only that account’s local listing', async () => {
    const original = { name: domainName, price: '100', currency: 'USD', status: 'ACTIVE' };
    await db.domainListing.create({
      data: { domainId, marketplace: 'afternic', providerAccountId: afternicId, binPrice: '100' },
    });
    let remote: typeof original | null = original;
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
    const job = await db.syncJob.create({
      data: { providerAccountId: afternicId, kind: 'providerChange' },
    });
    const change = await db.providerChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: afternicId,
        domainId,
        requestedBy: ownerId,
        action: 'removeListing',
        input: { action: 'removeListing', domainId, accountId: afternicId },
        snapshot: original,
        status: 'queued',
        syncJobId: job.id,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await runProviderChange(job.id);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await db.providerChange.findUniqueOrThrow({ where: { id: change.id } })).status).toBe(
      'completed',
    );
    expect(await db.domainListing.count({ where: { domainId, marketplace: 'afternic' } })).toBe(0);
    expect(await db.domainListing.count({ where: { domainId, marketplace: 'spaceship' } })).toBe(1);
    spy.mockRestore();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });
  it('does not resend an uncertain SellerHub removal and only removes the local record after a confirming read', async () => {
    const original = { name: domainName, price: '100', currency: 'USD', status: 'active' };
    let remote: typeof original | null = original;
    const remove = vi.fn(async () => {
      remote = null;
      throw new Error('response lost');
    });
    const spy = vi.spyOn(actions, 'actionClient').mockReturnValue({
      removeListing: remove,
      listing: async () => remote,
      nameservers: vi.fn(),
      setNameservers: vi.fn(),
      addListing: vi.fn(),
    });
    const job = await db.syncJob.create({
      data: { providerAccountId: sellerId, kind: 'providerChange' },
    });
    const change = await db.providerChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: sellerId,
        domainId,
        requestedBy: ownerId,
        action: 'removeListing',
        input: { action: 'removeListing', domainId, accountId: sellerId },
        snapshot: original,
        status: 'queued',
        syncJobId: job.id,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await runProviderChange(job.id);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await db.providerChange.findUniqueOrThrow({ where: { id: change.id } })).status).toBe(
      'completed',
    );
    expect(await db.domainListing.count({ where: { domainId, marketplace: 'spaceship' } })).toBe(0);
    await runProviderChange(job.id);
    expect(remove).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it('retains the local listing when an uncertain deletion cannot be verified', async () => {
    await db.domainListing.create({
      data: {
        domainId,
        marketplace: 'spaceship',
        providerAccountId: sellerId,
        binPrice: '100',
      },
    });
    const original = { name: domainName, price: '100', currency: 'USD', status: 'active' };
    const remove = vi.fn(async () => {
      throw new Error('response lost');
    });
    const spy = vi.spyOn(actions, 'actionClient').mockReturnValue({
      removeListing: remove,
      listing: async () => original,
      nameservers: vi.fn(),
      setNameservers: vi.fn(),
      addListing: vi.fn(),
    });
    const job = await db.syncJob.create({
      data: { providerAccountId: sellerId, kind: 'providerChange' },
    });
    const change = await db.providerChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: sellerId,
        domainId,
        requestedBy: ownerId,
        action: 'removeListing',
        input: { action: 'removeListing', domainId, accountId: sellerId },
        snapshot: original,
        status: 'queued',
        syncJobId: job.id,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await runProviderChange(job.id);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await db.providerChange.findUniqueOrThrow({ where: { id: change.id } })).status).toBe(
      'unverified',
    );
    expect(await db.domainListing.count({ where: { domainId, marketplace: 'spaceship' } })).toBe(1);
    spy.mockRestore();
  });
  it('rechecks a previously attempted Namecheap change without repeating the write', async () => {
    const wanted = ['ns1.new.test', 'ns2.new.test'];
    const setNameservers = vi.fn();
    const spy = vi.spyOn(actions, 'actionClient').mockReturnValue({
      removeListing: vi.fn(),
      listing: vi.fn(),
      nameservers: async () => wanted,
      setNameservers,
      addListing: vi.fn(),
    });
    const job = await db.syncJob.create({
      data: { providerAccountId: registrarId, kind: 'providerChange' },
    });
    const change = await db.providerChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: registrarId,
        domainId,
        requestedBy: ownerId,
        action: 'changeNameservers',
        input: {
          action: 'changeNameservers',
          domainId,
          accountId: registrarId,
          nameservers: wanted,
        },
        snapshot: {
          remote: ['ns1.old.test', 'ns2.old.test'],
          registration: await db.domainRegistration
            .findFirstOrThrow({
              where: { domainId, providerAccountId: registrarId },
              select: {
                id: true,
                registrar: true,
                source: true,
                providerAccountId: true,
                verifiedAt: true,
              },
            })
            .then((r) => ({ ...r, verifiedAt: r.verifiedAt!.toISOString() })),
        },
        status: 'executing',
        syncJobId: job.id,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await runProviderChange(job.id);
    expect(setNameservers).not.toHaveBeenCalled();
    expect((await db.providerChange.findUniqueOrThrow({ where: { id: change.id } })).status).toBe(
      'completed',
    );
    spy.mockRestore();
  });
});
