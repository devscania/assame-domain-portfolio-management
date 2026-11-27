import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { oauthAdapter } from '../src/lib/oauth-adapter';
import { createOAuthLinkIntent, consumeOAuthLinkIntent } from '../src/lib/oauth-link';
import { verifiedOAuthProfile } from '../src/lib/oauth-policy';
import { createLoginSession } from '../src/lib/login-sessions';
import { runGuardedOAuthLink } from '../src/lib/oauth-link-context';

describe('OAuth provider identity policy', () => {
  it('accepts only verified provider emails and stable IDs', () => {
    expect(
      verifiedOAuthProfile('google', { sub: '123', email: 'A@example.test', email_verified: true }),
    ).toBe(true);
    expect(
      verifiedOAuthProfile('google', {
        sub: '123',
        email: 'a@example.test',
        email_verified: false,
      }),
    ).toBe(false);
    expect(verifiedOAuthProfile('google', { email: 'a@example.test', email_verified: true })).toBe(
      false,
    );
    expect(
      verifiedOAuthProfile('discord', { id: '42', email: 'a@example.test', verified: true }),
    ).toBe(true);
    expect(verifiedOAuthProfile('discord', { id: '42', email: null, verified: true })).toBe(false);
    expect(
      verifiedOAuthProfile('discord', { id: '42', email: 'a@example.test', verified: false }),
    ).toBe(false);
    expect(
      verifiedOAuthProfile('other', { id: '42', email: 'a@example.test', verified: true }),
    ).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'OAuth accounts and explicit linking intents',
  () => {
    const email = `oauth-${randomUUID()}@example.test`;
    let userId = '';
    beforeAll(() => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
        throw new Error('A dedicated test database is required');
      vi.stubEnv('WELCOME_EMAILS_ENABLED', 'true');
    });
    afterAll(async () => {
      if (userId) {
        await db.organization.deleteMany({ where: { workspaceOwnerId: userId } });
        await db.user.deleteMany({ where: { id: userId } });
      }
      await db.$disconnect();
      vi.unstubAllEnvs();
    });
    it('creates a verified account and workspace and does not store provider tokens', async () => {
      const user = await oauthAdapter.createUser!({
        id: randomUUID(),
        email: email.toUpperCase(),
        emailVerified: null,
        name: 'OAuth test',
      });
      userId = user.id;
      expect(user.email).toBe(email);
      const created = await db.user.findUniqueOrThrow({
        where: { id: userId },
        include: { ownedWorkspaces: { include: { members: true } } },
      });
      expect(created.emailVerified).not.toBeNull();
      expect(created.ownedWorkspaces).toHaveLength(1);
      expect(created.ownedWorkspaces[0].members[0].userId).toBe(userId);
      expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(0);
      await oauthAdapter.linkAccount!({
        userId,
        type: 'oauth',
        provider: 'google',
        providerAccountId: 'subject-123',
        access_token: 'secret',
        refresh_token: 'refresh',
      });
      const account = await db.account.findFirstOrThrow({ where: { userId } });
      expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(1);
      expect(account.access_token).toBeNull();
      expect(account.refresh_token).toBeNull();
      expect((await oauthAdapter.getUserByEmail!(email.toUpperCase()))?.id).toBe(userId);
    });
    it('does not send a welcome message when an existing password user links OAuth', async () => {
      const existing = await db.user.create({
        data: {
          email: `link-${randomUUID()}@example.test`,
          emailVerified: new Date(),
          passwordHash: 'fixture',
        },
      });
      try {
        const login = await createLoginSession(existing.id, 0, 'credentials');
        expect(login).not.toBeNull();
        const account = {
          userId: existing.id,
          type: 'oauth',
          provider: 'discord',
          providerAccountId: randomUUID(),
        } as const;
        await expect(oauthAdapter.linkAccount!(account)).rejects.toThrow(
          'Explicit account linking required',
        );
        await runGuardedOAuthLink(
          { userId: existing.id, sessionId: login!.id, provider: 'discord' },
          () => oauthAdapter.linkAccount!(account),
        );
        expect(await db.welcomeNotice.count({ where: { ownerId: existing.id } })).toBe(0);
      } finally {
        await db.user.delete({ where: { id: existing.id } });
      }
    });
    it('binds intents to user and provider, consumes only once and invalidates on session revocation', async () => {
      const token = await createOAuthLinkIntent(userId, 'discord');
      expect(await consumeOAuthLinkIntent(userId, 'google', token)).toBe(false);
      expect(await consumeOAuthLinkIntent(randomUUID(), 'discord', token)).toBe(false);
      const results = await Promise.all([
        consumeOAuthLinkIntent(userId, 'discord', token),
        consumeOAuthLinkIntent(userId, 'discord', token),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const stale = await createOAuthLinkIntent(userId, 'google');
      await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      expect(await consumeOAuthLinkIntent(userId, 'google', stale)).toBe(false);
      const expired = await createOAuthLinkIntent(userId, 'google');
      await db.authToken.updateMany({
        where: { userId, kind: { startsWith: 'oauth-link:google:' } },
        data: { expiresAt: new Date(0) },
      });
      expect(await consumeOAuthLinkIntent(userId, 'google', expired)).toBe(false);
    });
  },
);
