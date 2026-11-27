import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { encrypt } from '../src/lib/security';
import type { Context } from '../src/lib/access';
import * as actions from '../src/integrations/actions';
import {
  previewProviderChange,
  confirmProviderChange,
  runProviderChange,
  recheckNameserverChange,
  providerActionPolicy,
} from '../src/lib/provider-changes';
vi.mock('../src/integrations/http', async (original) => ({
  ...(await original<typeof import('../src/integrations/http')>()),
  sleep: vi.fn(async () => undefined),
}));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'bound nameserver changes and removed TXT actions',
  () => {
    let ownerId = '',
      orgId = '',
      domainId = '',
      registrationId = '',
      accountId = '',
      otherAccountId = '',
      foreignOrgId = '',
      foreignAccountId = '';
    let ctx: Context;
    const old = ['ns1.old.test', 'ns2.old.test'],
      wanted = ['ns1.new.test', 'ns2.new.test'];
    let remote = [...old],
      applyImmediately = true;
    const write = vi.fn(async () => {
      if (applyImmediately) remote = [...wanted];
    });
    let spy: ReturnType<typeof vi.spyOn>;
    const input = () => ({ action: 'changeNameservers', domainId, accountId, nameservers: wanted });
    beforeEach(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
        throw new Error('Dedicated test database required');
      vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32));
      const owner = await db.user.create({ data: { email: `ns-${randomUUID()}@example.test` } });
      ownerId = owner.id;
      const org = await db.organization.create({
        data: {
          name: 'Nameserver fixture',
          workspaceOwnerId: ownerId,
          providerActionsEnabled: true,
          members: { create: { userId: ownerId, role: 'OWNER' } },
        },
      });
      orgId = org.id;
      foreignOrgId = (
        await db.organization.create({
          data: {
            name: 'Separate workspace',
            workspaceOwnerId: ownerId,
            members: { create: { userId: ownerId, role: 'OWNER' } },
          },
        })
      ).id;
      for (const id of ['namecheap', 'spaceship'])
        await db.provider.upsert({
          where: { id },
          create: { id, name: id, kind: 'registrar' },
          update: {},
        });
      const account = async (organizationId: string, providerId: string) =>
        db.providerAccount.create({
          data: {
            organizationId,
            providerId,
            status: 'connected',
            label: randomUUID(),
            credential: {
              create: {
                ciphertext: encrypt({ apiKey: 'fixture', apiSecret: 'fixture' }),
                updatedAt: new Date(Date.now() - 86400000),
              },
            },
          },
        });
      accountId = (await account(orgId, 'namecheap')).id;
      otherAccountId = (await account(orgId, 'spaceship')).id;
      foreignAccountId = (await account(foreignOrgId, 'namecheap')).id;
      const domain = await db.domain.create({
        data: {
          organizationId: orgId,
          name: 'nameserver-workflow.test',
          unicodeName: 'nameserver-workflow.test',
          tld: 'test',
        },
      });
      domainId = domain.id;
      registrationId = (
        await db.domainRegistration.create({
          data: {
            domainId,
            providerAccountId: accountId,
            registrar: 'Namecheap',
            source: 'namecheap',
            verifiedAt: new Date(Date.now() - 60000),
            nameservers: old,
          },
        })
      ).id;
      ctx = { user: { id: ownerId }, org, role: 'OWNER', members: [] } as unknown as Context;
      remote = [...old];
      applyImmediately = true;
      write.mockClear();
      spy = vi
        .spyOn(actions, 'actionClient')
        .mockReturnValue({
          nameservers: async () => [...remote],
          setNameservers: write,
          listing: vi.fn(),
          removeListing: vi.fn(),
          addListing: vi.fn(),
        });
    });
    afterEach(async () => {
      spy?.mockRestore();
      vi.unstubAllEnvs();
      await db.organization.deleteMany({ where: { id: { in: [orgId, foreignOrgId] } } });
      await db.user.deleteMany({ where: { id: ownerId } });
    });
    it('rejects another workspace, unrelated registrar or unverified registration before provider reads', async () => {
      await expect(
        previewProviderChange(ctx, { ...input(), accountId: foreignAccountId }),
      ).rejects.toThrow();
      await expect(
        previewProviderChange(ctx, { ...input(), accountId: otherAccountId }),
      ).rejects.toThrow('actual supported registrar');
      await db.domainRegistration.update({
        where: { id: registrationId },
        data: { verifiedAt: null },
      });
      await expect(previewProviderChange(ctx, input())).rejects.toThrow(
        'actual supported registrar',
      );
      expect(spy).not.toHaveBeenCalled();
    });
    it('hides policy accounts for disabled writes, non-admins and deny-only custom roles', async () => {
      expect((await providerActionPolicy(ctx)).accounts).toHaveLength(2);
      expect((await providerActionPolicy({ ...ctx, role: 'EDITOR' })).accounts).toEqual([]);
      vi.stubEnv('PROVIDER_WRITES_ENABLED', 'false');
      expect((await providerActionPolicy(ctx)).accounts).toEqual([]);
      vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
      const role = await db.workspaceCustomRole.create({
        data: {
          organizationId: orgId,
          name: 'No publishing',
          baseRole: 'ADMIN',
          allowProviderWrites: false,
        },
      });
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId: ownerId } },
        data: { role: 'ADMIN', customRoleId: role.id },
      });
      expect((await providerActionPolicy({ ...ctx, role: 'ADMIN' })).accounts).toEqual([]);
    });
    it('writes once and updates only the exact verified registration after matching remote readback', async () => {
      const preview = await previewProviderChange(ctx, input());
      expect(preview.currentNameservers).toEqual(old);
      const accepted = await confirmProviderChange(ctx, preview.id);
      await runProviderChange(accepted.jobId);
      expect(write).toHaveBeenCalledOnce();
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
      ).toBe('completed');
      const registration = await db.domainRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      expect(registration).toMatchObject({
        nameservers: wanted,
        providerAccountId: accountId,
        source: 'namecheap',
      });
    });
    it('requires a fresh preview after registrar binding changes and blocks revoked permissions before sending', async () => {
      const preview = await previewProviderChange(ctx, input());
      await db.domainRegistration.update({
        where: { id: registrationId },
        data: { source: 'manual' },
      });
      await expect(confirmProviderChange(ctx, preview.id)).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
      await db.domainRegistration.update({
        where: { id: registrationId },
        data: { source: 'namecheap' },
      });
      const next = await previewProviderChange(ctx, input()),
        accepted = await confirmProviderChange(ctx, next.id);
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId: ownerId } },
        data: { role: 'VIEWER' },
      });
      await runProviderChange(accepted.jobId);
      expect(write).not.toHaveBeenCalled();
      expect((await db.providerChange.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
        'failed',
      );
    });
    it('keeps an unconfirmed result out of registration data and rechecks without repeating the mutation', async () => {
      applyImmediately = false;
      const preview = await previewProviderChange(ctx, input()),
        accepted = await confirmProviderChange(ctx, preview.id);
      await runProviderChange(accepted.jobId);
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
      ).toBe('unverified');
      expect(
        (await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } }))
          .nameservers,
      ).toEqual(old);
      remote = [...wanted];
      // Inventory can observe the applied settings before this job is rechecked.
      await db.domainRegistration.update({
        where: { id: registrationId },
        data: { nameservers: wanted, verifiedAt: new Date() },
      });
      await recheckNameserverChange(ctx, preview.id);
      await runProviderChange(accepted.jobId);
      expect(write).toHaveBeenCalledOnce();
      expect(
        (await db.providerChange.findUniqueOrThrow({ where: { id: preview.id } })).status,
      ).toBe('completed');
      expect(
        (await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } }))
          .nameservers,
      ).toEqual(wanted);
    });
    it('rejects removed TXT previews, confirmation and queued execution before any provider client is constructed', async () => {
      const removed = {
        action: 'verificationTxt',
        domainId,
        accountId,
        host: '@',
        value: 'fixture',
      };
      await expect(previewProviderChange(ctx, removed)).rejects.toThrow();
      const job = await db.syncJob.create({
        data: { providerAccountId: accountId, kind: 'providerChange' },
      });
      const change = await db.providerChange.create({
        data: {
          organizationId: orgId,
          domainId,
          providerAccountId: accountId,
          requestedBy: ownerId,
          action: 'verificationTxt',
          input: removed,
          snapshot: {},
          expiresAt: new Date(Date.now() + 60000),
          syncJobId: job.id,
        },
      });
      await expect(confirmProviderChange(ctx, change.id)).rejects.toThrow('unavailable');
      await db.providerChange.update({ where: { id: change.id }, data: { status: 'queued' } });
      await runProviderChange(job.id);
      expect(spy).not.toHaveBeenCalled();
      expect((await db.providerChange.findUniqueOrThrow({ where: { id: change.id } })).status).toBe(
        'failed',
      );
    });
  },
);
