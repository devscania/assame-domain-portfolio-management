import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter } from 'next-auth/adapters';
import { db } from '@/lib/db';
import { queueWelcomeNotice } from '@/lib/welcome-notices';
import { consumeGuardedOAuthLink } from '@/lib/oauth-link-context';

/** Provision a workspace only for an Auth.js-created OAuth account. */
export const oauthAdapter: Adapter = {
  ...PrismaAdapter(db),
  async createUser(profile) {
    if (!profile.email) throw new Error('Verified provider email required');
    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: profile.email.toLowerCase(),
          name: profile.name?.slice(0, 100) || null,
          emailVerified: new Date(),
          oauthSignupPending: { create: {} },
        },
      });
      await tx.organization.create({
        data: {
          name: 'My portfolio',
          workspaceOwnerId: user.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      return user;
    });
  },
  async getUserByEmail(email) {
    return db.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  },
  async linkAccount(account) {
    // These login providers are used for identity only; OAuth access/refresh tokens are not needed.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${account.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: account.userId },
        select: {
          deletedAt: true,
          emailVerified: true,
          passwordHash: true,
          sessionVersion: true,
          oauthSignupPending: true,
        },
      });
      if (!user || user.deletedAt) throw new Error('Account unavailable');
      const accountCount = await tx.account.count({ where: { userId: account.userId } });
      const newSignup =
        user.oauthSignupPending &&
        !user.oauthSignupPending.recovered &&
        !user.passwordHash &&
        accountCount === 0 &&
        !(await tx.accountLoginSession.count({ where: { userId: account.userId } })) &&
        !(await tx.session.count({ where: { userId: account.userId } }));
      if (!newSignup) {
        // Existing accounts and recovered signups require this request's guarded grant.
        const grant = consumeGuardedOAuthLink(account.userId, account.provider);
        if (!grant) throw new Error('Explicit account linking required');
        await tx.$queryRaw`SELECT id FROM "AccountLoginSession" WHERE id = ${grant.sessionId} FOR UPDATE`;
        const session = await tx.accountLoginSession.findFirst({
          where: {
            id: grant.sessionId,
            userId: account.userId,
            sessionVersion: user.sessionVersion,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session) throw new Error('Account linking session expired');
      }
      const firstSignIn = !user.passwordHash && user.emailVerified && accountCount === 0;
      await tx.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
      await tx.oAuthSignupPending.deleteMany({ where: { userId: account.userId } });
      if (firstSignIn) await queueWelcomeNotice(tx, account.userId);
    });
  },
};
