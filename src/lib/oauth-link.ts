import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { hashAuthToken } from '@/lib/auth-email';
import type { OAuthProvider } from '@/lib/oauth-policy';

export const linkCookie = 'assame.oauth-link';
export async function createOAuthLinkIntent(userId: string, provider: OAuthProvider) {
  const raw = randomBytes(32).toString('base64url');
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionVersion: true, deletedAt: true },
    });
    if (user.deletedAt) throw new Error('Account unavailable');
    await tx.authToken.deleteMany({
      where: { userId, kind: { startsWith: `oauth-link:${provider}:` } },
    });
    await tx.authToken.create({
      data: {
        userId,
        kind: `oauth-link:${provider}:${user.sessionVersion}`,
        tokenHash: hashAuthToken(raw),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  });
  return raw;
}
export async function consumeOAuthLinkIntent(
  userId: string,
  provider: OAuthProvider,
  raw: string | undefined,
) {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return false;
  const result = await db.authToken.deleteMany({
    where: {
      userId,
      kind: `oauth-link:${provider}:${user.sessionVersion}`,
      tokenHash: hashAuthToken(raw),
      expiresAt: { gt: new Date() },
    },
  });
  return result.count === 1;
}
