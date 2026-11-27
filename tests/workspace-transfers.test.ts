import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { requestWorkspaceTransfer, resolveWorkspaceTransfer } from '../src/lib/workspace-transfers';
import { removeWorkspaceMember } from '../src/lib/workspace-members';

describe.skipIf(!process.env.TEST_DATABASE_URL)('workspace ownership transfers', () => {
  let sender = '',
    recipient = '',
    outsider = '',
    email = '',
    first = '',
    second = '',
    recipientWorkspace = '';
  beforeEach(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    const suffix = randomUUID();
    const users = await Promise.all(
      ['sender', 'recipient', 'outsider'].map((prefix) =>
        db.user.create({
          data: {
            email: `${prefix}-${suffix}@example.test`,
          },
        }),
      ),
    );
    [sender, recipient, outsider] = users.map((user) => user.id);
    email = users[1].email;
    const make = async (name: string) =>
      db.organization.create({
        data: {
          name,
          workspaceOwnerId: sender,
          members: {
            create: [
              { userId: sender, role: 'OWNER' },
              { userId: recipient, role: 'EDITOR' },
            ],
          },
          domains: {
            create: {
              name: `${name.toLowerCase()}-${suffix}.test`,
              unicodeName: `${name.toLowerCase()}-${suffix}.test`,
              tld: 'test',
            },
          },
        },
      });
    first = (await make('First')).id;
    second = (await make('Second')).id;
    recipientWorkspace = '';
  });
  afterEach(async () => {
    await db.organization.deleteMany({
      where: { id: { in: [first, second, recipientWorkspace] } },
    });
    await db.user.deleteMany({ where: { id: { in: [sender, recipient, outsider] } } });
  });
  it('removes or leaves shared workspaces without allowing owner removal and cancels pending transfers', async () => {
    const membership = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: first, userId: recipient } },
    });
    const owner = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: first, userId: sender } },
    });
    const transfer = await requestWorkspaceTransfer(sender, first, email, 'First');
    await expect(removeWorkspaceMember(outsider, first, membership.id, 'remove')).rejects.toThrow();
    await expect(removeWorkspaceMember(recipient, first, owner.id, 'remove')).rejects.toThrow(
      'owner',
    );
    await expect(removeWorkspaceMember(sender, first, owner.id, 'leave')).rejects.toThrow('owner');
    await removeWorkspaceMember(sender, first, membership.id, 'remove');
    expect(await db.organizationMember.findUnique({ where: { id: membership.id } })).toBeNull();
    expect(
      (await db.workspaceTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status,
    ).toBe('cancelled');
    expect(await db.domain.count({ where: { organizationId: first } })).toBe(1);
    const remaining = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: second, userId: recipient } },
    });
    await expect(removeWorkspaceMember(recipient, second, remaining.id, 'leave')).rejects.toThrow(
      'another workspace',
    );
    await db.organizationMember.create({
      data: { organizationId: first, userId: recipient, role: 'VIEWER' },
    });
    await removeWorkspaceMember(recipient, second, remaining.id, 'leave');
    expect(await db.organizationMember.findUnique({ where: { id: remaining.id } })).toBeNull();
  });
  it('creates an empty personal workspace when the owner removes a user with no other workspace', async () => {
    await db.organizationMember.delete({
      where: { organizationId_userId: { organizationId: second, userId: recipient } },
    });
    const membership = await db.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: first, userId: recipient } },
    });
    await removeWorkspaceMember(sender, first, membership.id, 'remove');
    const replacement = await db.organization.findFirstOrThrow({
      where: { workspaceOwnerId: recipient },
      include: { members: true, domains: true },
    });
    try {
      expect(replacement.members).toEqual([
        expect.objectContaining({ userId: recipient, role: 'OWNER' }),
      ]);
      expect(replacement.domains).toHaveLength(0);
      expect(await db.domain.count({ where: { organizationId: first } })).toBe(1);
    } finally {
      await db.organization.delete({ where: { id: replacement.id } });
    }
  });
  it('requires both parties and preserves the workspace and its domains', async () => {
    await expect(requestWorkspaceTransfer(outsider, first, email, 'First')).rejects.toThrow(
      'ownership',
    );
    await expect(requestWorkspaceTransfer(sender, first, email, 'wrong')).rejects.toThrow(
      'exact workspace name',
    );
    await expect(
      requestWorkspaceTransfer(sender, first, 'nobody@example.test', 'First'),
    ).rejects.toThrow('existing member');
    const transfer = await requestWorkspaceTransfer(sender, first, email, 'First');
    await expect(resolveWorkspaceTransfer(outsider, transfer.id, 'accept')).rejects.toThrow(
      'not found',
    );
    await resolveWorkspaceTransfer(recipient, transfer.id, 'accept');
    expect(
      await db.organization.findUniqueOrThrow({
        where: { id: first },
        include: { members: true, domains: true, audits: true },
      }),
    ).toMatchObject({
      workspaceOwnerId: recipient,
      domains: [{ organizationId: first }],
      members: expect.arrayContaining([
        expect.objectContaining({ userId: sender, role: 'ADMIN' }),
        expect.objectContaining({ userId: recipient, role: 'OWNER' }),
      ]),
      audits: expect.arrayContaining([
        expect.objectContaining({ action: 'workspace.transfer.accepted' }),
      ]),
    });
    await expect(resolveWorkspaceTransfer(recipient, transfer.id, 'accept')).rejects.toThrow(
      'no longer pending',
    );
  });

  it('rejects expired requests and permits a fresh request', async () => {
    const transfer = await requestWorkspaceTransfer(sender, first, email, 'First');
    await db.workspaceTransfer.update({
      where: { id: transfer.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(resolveWorkspaceTransfer(recipient, transfer.id, 'accept')).rejects.toThrow(
      'no longer pending',
    );
    const fresh = await requestWorkspaceTransfer(sender, first, email, 'First');
    expect(fresh.id).not.toBe(transfer.id);
    expect(
      await db.workspaceTransfer.findUniqueOrThrow({ where: { id: transfer.id } }),
    ).toMatchObject({ status: 'expired' });
    await resolveWorkspaceTransfer(recipient, fresh.id, 'decline');
  });
});
