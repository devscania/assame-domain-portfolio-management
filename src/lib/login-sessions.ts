import { randomUUID } from 'node:crypto';
import { db } from './db';

export const loginSessionLifetimeMs = 8 * 60 * 60 * 1000;

/** Serialize session creation with password, provider and account changes. */
export async function createLoginSession(
  userId: string,
  expectedVersion: number | undefined,
  method: string,
  providerAccountId?: string,
  oauthSignup = false,
) {
  if (!['credentials', 'google', 'discord'].includes(method)) return null;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true, deletedAt: true },
    });
    if (
      !user ||
      user.deletedAt ||
      (expectedVersion !== undefined && user.sessionVersion !== expectedVersion)
    )
      return null;
    if (method !== 'credentials') {
      if (
        !providerAccountId ||
        !(await tx.account.findFirst({
          where: { userId, provider: method, providerAccountId },
          select: { id: true },
        }))
      )
        return null;
    }
    const now = new Date();
    await tx.accountLoginSession.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lte: now } }, { sessionVersion: { not: user.sessionVersion } }],
      },
    });
    return tx.accountLoginSession.create({
      data: {
        id: randomUUID(),
        userId,
        method,
        oauthSignupPending: oauthSignup && ['google', 'discord'].includes(method),
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(now.getTime() + loginSessionLifetimeMs),
      },
    });
  });
}

export async function validLoginSession(userId: string, sessionId: string, version: unknown) {
  if (typeof version !== 'number') return false;
  const session = await db.accountLoginSession.findFirst({
    where: {
      id: sessionId,
      userId,
      sessionVersion: version,
      expiresAt: { gt: new Date() },
      user: { deletedAt: null, sessionVersion: version },
    },
    select: { id: true },
  });
  return Boolean(session);
}
