import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { deleteAccount, deleteOwnedWorkspace } from '../src/lib/account-security';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('account and workspace removal safety', () => {
  const userIds: string[] = [],
    orgIds: string[] = [];
  const password = 'SecureDeletionPassword!2026';
  let passwordHash = '';
  async function user() {
    const record = await db.user.create({
      data: { email: `deletion-${randomUUID()}@example.test`, passwordHash },
    });
    userIds.push(record.id);
    return record;
  }
  async function workspace(ownerId: string | null, owners: string[], others: string[] = []) {
    const record = await db.organization.create({
      data: {
        name: 'Deletion fixture',
        workspaceOwnerId: ownerId,
        members: {
          create: [
            ...owners.map((userId) => ({ userId, role: 'OWNER' as const })),
            ...others.map((userId) => ({ userId, role: 'VIEWER' as const })),
          ],
        },
      },
    });
    orgIds.push(record.id);
    return record;
  }
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('A dedicated test database is required');
    passwordHash = await hash(password, { type: 2 });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });
  it('refuses deletion when the owner role and workspace owner disagree', async () => {
    const actor = await user(),
      actual = await user();
    const org = await workspace(actual.id, [actor.id]);
    await expect(deleteAccount(actor.id, password)).rejects.toMatchObject({ status: 409 });
    await expect(deleteOwnedWorkspace(actor.id, org.id)).rejects.toMatchObject({ status: 403 });
    expect(await db.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: actor.id } })).not.toBeNull();
  });
  it('blocks account removal while shared workspaces remain', async () => {
    const owner = await user(),
      member = await user();
    const org = await workspace(owner.id, [owner.id], [member.id]);
    await expect(deleteAccount(owner.id, password)).rejects.toMatchObject({ status: 409 });
    await db.organizationMember.delete({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
    });
    await deleteAccount(owner.id, password);
    expect(await db.user.findUnique({ where: { id: owner.id } })).toBeNull();
    expect(await db.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: member.id } })).not.toBeNull();
  });
  it('allows an owner to remove a non-final workspace but blocks multiple owners', async () => {
    const owner = await user(),
      other = await user();
    const first = await workspace(owner.id, [owner.id]);
    const second = await workspace(owner.id, [owner.id, other.id]);
    await expect(deleteOwnedWorkspace(owner.id, second.id)).rejects.toMatchObject({ status: 403 });
    await deleteOwnedWorkspace(owner.id, first.id);
    expect(await db.organization.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await db.organization.findUnique({ where: { id: second.id } })).not.toBeNull();
  });
});
