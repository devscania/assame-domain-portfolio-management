import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import type { Context } from '../src/lib/access';
import { confirmListingPrice } from '../src/lib/listing-prices';
import { confirmProviderChange } from '../src/lib/provider-changes';
const fixture = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('../src/lib/access', async () => ({
  requireRole: (await import('../src/lib/permissions')).requireRole,
  context: async () => fixture.context,
}));
import { POST } from '../src/app/api/console/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('safe local provider records', () => {
  let userId = '',
    orgId = '',
    domainId = '',
    registrationId = '',
    listingId = '';
  const origin = 'http://localhost:3010';
  const request = (action: string, data: object) =>
    new Request(`${origin}/api/console`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ action, data }),
    });
  const call = async (action: string, data: object) => POST(request(action, data));
  const network = vi.fn(async () => {
    throw new Error('Unexpected external request');
  });
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('AUTH_SECRET', 'test-secret-for-signed-previews');
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    vi.stubGlobal('fetch', network);
    const user = await db.user.create({
      data: {
        email: `provider-safety-${randomUUID()}@example.test`,
      },
    });
    userId = user.id;
    const org = await db.organization.create({
      data: {
        name: 'Provider safety',
        workspaceOwnerId: userId,
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    fixture.context = { user: { id: userId, email: user.email }, org, role: 'OWNER', members: [] };
    await db.provider.upsert({
      where: { id: 'namecheap' },
      create: { id: 'namecheap', name: 'Namecheap', kind: 'registrar' },
      update: {},
    });
    const account = await db.providerAccount.create({
      data: {
        organizationId: orgId,
        providerId: 'namecheap',
        label: randomUUID(),
        status: 'connected',
        credential: { create: { ciphertext: 'not-a-decryptable-credential' } },
      },
    });
    const domain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'safety.test',
        unicodeName: 'safety.test',
        tld: 'test',
        registrations: {
          create: {
            registrar: 'namecheap',
            providerAccountId: account.id,
            nameservers: ['old.example.test'],
            verifiedAt: new Date(),
          },
        },
        listings: {
          create: {
            marketplace: 'namecheap',
            providerAccountId: account.id,
            binPrice: '100',
            verifiedAt: new Date(),
          },
        },
      },
      include: { registrations: true, listings: true },
    });
    domainId = domain.id;
    registrationId = domain.registrations[0].id;
    listingId = domain.listings[0].id;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: userId } });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('records individual and bulk nameservers locally without provider calls or false verification', async () => {
    const single = await call('registration.nameservers', {
      registrationId,
      nameservers: ['ns1.example.test'],
    });
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({ scope: 'portfolio' });
    expect(
      await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } }),
    ).toMatchObject({
      nameservers: ['ns1.example.test'],
      source: 'manual-nameservers',
      verifiedAt: null,
    });
    expect(await db.syncJob.count({ where: { account: { organizationId: orgId } } })).toBe(0);
    const preview = await call('bulk.preview', {
      ids: [domainId],
      field: 'nameservers',
      value: 'ns2.example.test',
    });
    expect(preview.status).toBe(200);
    const { token } = await preview.json();
    expect((await call('bulk.confirm', { token })).status).toBe(200);
    expect(
      await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } }),
    ).toMatchObject({ nameservers: ['ns2.example.test'], verifiedAt: null });
    expect(network).not.toHaveBeenCalled();
  });
  it('rolls back bulk nameserver edits when a domain has no registration', async () => {
    const missing = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'missing-registration.test',
        unicodeName: 'missing-registration.test',
        tld: 'test',
      },
    });
    const preview = await call('bulk.preview', {
      ids: [domainId, missing.id],
      field: 'nameservers',
      value: 'ns3.example.test',
    });
    expect(preview.status).toBe(200);
    const { token } = await preview.json();
    expect((await call('bulk.confirm', { token })).status).toBe(409);
    expect(
      (await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } }))
        .nameservers,
    ).toEqual(['ns2.example.test']);
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects remote delisting and preserves listing records', async () => {
    expect((await call('listing.delist', { listingId })).status).toBe(409);
    expect(
      (await call('listing.bulk_delist', { domainIds: [domainId], marketplace: 'namecheap' }))
        .status,
    ).toBe(409);
    expect(await db.domainListing.findUnique({ where: { id: listingId } })).not.toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it('blocks unverified marketplace price changes while allowing internal asking prices', async () => {
    expect(
      (await call('domain.asking_price', { domainId, askingPrice: '200', syncMarketplaces: true }))
        .status,
    ).toBe(409);
    expect(
      (await call('bulk.preview', { ids: [domainId], askingPrice: '200', syncMarketplaces: true }))
        .status,
    ).toBe(409);
    const domain = await db.domain.findUniqueOrThrow({ where: { id: domainId } });
    const payload = Buffer.from(
      JSON.stringify({
        org: orgId,
        actor: userId,
        field: 'askingPrice',
        rows: [{ id: domainId, name: domain.name, updatedAt: domain.updatedAt.toISOString() }],
        value: '200',
        syncMarketplaces: true,
        expires: Date.now() + 60000,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', 'test-secret-for-signed-previews')
      .update(payload)
      .digest('hex');
    expect((await call('bulk.confirm', { token: `${payload}.${signature}` })).status).toBe(409);
    expect((await call('domain.asking_price', { domainId, askingPrice: '200' })).status).toBe(200);
    expect(
      (await db.domainListing.findUniqueOrThrow({ where: { id: listingId } })).binPrice?.toString(),
    ).toBe('100');
    expect(
      (await db.domain.findUniqueOrThrow({ where: { id: domainId } })).askingPrice?.toString(),
    ).toBe('200');
    expect(network).not.toHaveBeenCalled();
  });
  it('rechecks current membership even when the request context is stale', async () => {
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { role: 'VIEWER' },
    });
    try {
      expect((await call('note.create', { domainId, body: 'Should not be recorded' })).status).toBe(
        403,
      );
      expect((await call('domain.delete', { id: domainId })).status).toBe(403);
      expect(await db.domainNote.count({ where: { domainId } })).toBe(0);
      expect((await db.domain.findUniqueOrThrow({ where: { id: domainId } })).deletedAt).toBeNull();
    } finally {
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'OWNER' },
      });
    }
  });
  it('rechecks provider-write settings and roles when confirming previews', async () => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const listing = await db.domainListing.findUniqueOrThrow({ where: { id: listingId } });
    const accountId = listing.providerAccountId!;
    const staleCtx = {
      ...(fixture.context as Context),
      org: { ...org, pricePublishingEnabled: true, providerActionsEnabled: true },
    } as Context;
    const price = await db.listingPriceChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: accountId,
        listingId,
        requestedBy: userId,
        oldPrice: '100',
        newPrice: '200',
        currency: 'USD',
        remoteStatus: 'active',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const change = await db.providerChange.create({
      data: {
        organizationId: orgId,
        providerAccountId: accountId,
        domainId,
        requestedBy: userId,
        action: 'addListing',
        input: {},
        snapshot: {},
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await expect(confirmListingPrice(staleCtx, price.id)).rejects.toThrow(
      'Enable provider price publishing',
    );
    await expect(confirmProviderChange(staleCtx, change.id)).rejects.toThrow(
      'Enable provider actions',
    );
    await db.organization.update({
      where: { id: orgId },
      data: { pricePublishingEnabled: true, providerActionsEnabled: true },
    });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { role: 'VIEWER' },
    });
    try {
      await expect(confirmListingPrice(staleCtx, price.id)).rejects.toMatchObject({ status: 403 });
      await expect(confirmProviderChange(staleCtx, change.id)).rejects.toMatchObject({
        status: 403,
      });
      expect(await db.syncJob.count({ where: { providerAccountId: accountId } })).toBe(0);
    } finally {
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'OWNER' },
      });
    }
  });
  it('allows domain-removal recovery when workspace ownership is unresolved', async () => {
    const recovery = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'recovery.test',
        unicodeName: 'recovery.test',
        tld: 'test',
      },
    });
    await db.organization.update({ where: { id: orgId }, data: { workspaceOwnerId: null } });
    try {
      const custom = await db.workspaceCustomRole.create({
        data: {
          organizationId: orgId,
          name: 'Unresolved recovery',
          baseRole: 'EDITOR',
          allowDomainDeletion: true,
        },
      });
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'EDITOR', customRoleId: custom.id },
      });
      expect((await call('domain.delete', { id: recovery.id })).status).toBe(403);
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'VIEWER', customRoleId: null },
      });
      expect((await call('domain.delete', { id: recovery.id })).status).toBe(403);
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'OWNER' },
      });
      expect((await call('domain.delete', { id: recovery.id })).status).toBe(200);
      expect(
        (await db.domain.findUniqueOrThrow({ where: { id: recovery.id } })).deletedAt,
      ).not.toBeNull();
      expect(
        await db.auditLog.count({
          where: { organizationId: orgId, entityId: recovery.id, action: 'domain.deleted' },
        }),
      ).toBe(1);
    } finally {
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: 'OWNER', customRoleId: null },
      });
      await db.organization.update({ where: { id: orgId }, data: { workspaceOwnerId: userId } });
    }
  });
});
