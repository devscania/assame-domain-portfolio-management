import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const sent = vi.hoisted(() => ({ token: '' }));
vi.mock('../src/lib/auth-email', () => ({
  emailConfigured: () => true,
  hashAuthToken: (raw: string) => `hash:${raw}`,
  sendAccountRemovalLink: async (_email: string, token: string) => {
    sent.token = token;
  },
}));
import { requestAccountRemoval, confirmAccountRemoval } from '../src/lib/account-removal-email';

describe.skipIf(!process.env.TEST_DATABASE_URL)('OAuth account removal via email', () => {
  let userId = '',
    sessionId = '',
    otherId = '',
    workspaceId = '';
  beforeEach(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('Dedicated test database required');
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        emailVerified: new Date(),
      },
    });
    userId = user.id;
    sessionId = randomUUID();
    await db.accountLoginSession.create({
      data: {
        id: sessionId,
        userId,
        method: 'google',
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    otherId = (await db.user.create({ data: { email: `${randomUUID()}@example.test` } })).id;
    workspaceId = (
      await db.organization.create({
        data: {
          name: 'Test',
          workspaceOwnerId: userId,
          members: { create: { userId, role: 'OWNER' } },
        },
      })
    ).id;
    sent.token = '';
  });
  afterEach(async () => {
    await db.organization.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });
  it('binds the one-use confirmation to the requesting session', async () => {
    await requestAccountRemoval(userId, sessionId);
    expect(sent.token).toHaveLength(43);
    const otherSession = randomUUID();
    await db.accountLoginSession.create({
      data: {
        id: otherSession,
        userId,
        method: 'google',
        sessionVersion: 0,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await expect(confirmAccountRemoval(userId, otherSession, sent.token)).rejects.toThrow(
      'same signed-in browser',
    );
    await confirmAccountRemoval(userId, sessionId, sent.token);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    await expect(confirmAccountRemoval(userId, sessionId, sent.token)).rejects.toThrow();
  });
  it('does not consume the token when a shared workspace blocks removal', async () => {
    await requestAccountRemoval(userId, sessionId);
    await db.organizationMember.create({
      data: { organizationId: workspaceId, userId: otherId, role: 'VIEWER' },
    });
    await expect(confirmAccountRemoval(userId, sessionId, sent.token)).rejects.toThrow(
      'shared workspaces',
    );
    expect(
      await db.authToken.count({ where: { userId, kind: { startsWith: 'account-removal:' } } }),
    ).toBe(1);
    expect(await db.user.findUnique({ where: { id: userId } })).not.toBeNull();
  });
  it('rejects revoked sessions and expired confirmation links', async () => {
    await requestAccountRemoval(userId, sessionId);
    await db.authToken.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
    await expect(confirmAccountRemoval(userId, sessionId, sent.token)).rejects.toThrow('expired');
    await requestAccountRemoval(userId, sessionId);
    await db.accountLoginSession.delete({ where: { id: sessionId } });
    await expect(confirmAccountRemoval(userId, sessionId, sent.token)).rejects.toThrow('Sign in');
    expect(await db.user.findUnique({ where: { id: userId } })).not.toBeNull();
  });
});
