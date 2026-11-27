import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { emailConfigured, hashAuthToken, sendSignInRemovalLink } from './auth-email';
import { isOAuthProvider, providerEnabled, type OAuthProvider } from './oauth-policy';
import { AppError } from './security';

async function assertRemovable(
  tx: Prisma.TransactionClient,
  userId: string,
  provider: OAuthProvider,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      emailVerified: true,
      passwordHash: true,
      verificationRequired: true,
      sessionVersion: true,
      accounts: { select: { provider: true } },
    },
  });
  if (!user || !user.emailVerified)
    throw new AppError('Verify your account email before removing a sign-in method.', 409);
  if (!user.accounts.some((account) => account.provider === provider))
    throw new AppError('Sign-in method is not connected.', 404);
  const passwordUsable = Boolean(
    user.passwordHash && (!user.verificationRequired || user.emailVerified),
  );
  const anotherProvider = user.accounts.some(
    (account) =>
      account.provider !== provider &&
      isOAuthProvider(account.provider) &&
      providerEnabled(account.provider),
  );
  if (!passwordUsable && !anotherProvider)
    throw new AppError('Add another available sign-in method before removing this one.', 409);
  return user;
}
export async function requestSignInRemoval(userId: string, provider: OAuthProvider) {
  if (!emailConfigured()) throw new AppError('Email service is not configured', 503);
  const raw = randomBytes(32).toString('base64url');
  const email = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await assertRemovable(tx, userId, provider);
    await tx.authToken.deleteMany({ where: { userId, kind: { startsWith: 'unlink:' } } });
    await tx.authToken.create({
      data: {
        userId,
        kind: `unlink:${provider}:${user.sessionVersion}`,
        tokenHash: hashAuthToken(raw),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return user.email;
  });
  await sendSignInRemovalLink(email, provider, raw);
}
export async function confirmSignInRemoval(raw: string) {
  const tokenHash = hashAuthToken(raw);
  await db.$transaction(async (tx) => {
    const initial = await tx.authToken.findUnique({ where: { tokenHash } });
    if (!initial) throw new AppError('This link is invalid or has expired.', 400);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${initial.userId} FOR UPDATE`;
    const token = await tx.authToken.findUnique({ where: { tokenHash } });
    const match = token?.kind.match(/^unlink:(google|discord):(0|[1-9]\d*)$/);
    if (!token || !match || token.expiresAt <= new Date())
      throw new AppError('This link is invalid or has expired.', 400);
    const version = Number(match[2]);
    if (!Number.isSafeInteger(version))
      throw new AppError('This link is invalid or has expired.', 400);
    const provider = match[1] as OAuthProvider;
    const user = await assertRemovable(tx, token.userId, provider);
    if (user.sessionVersion !== version)
      throw new AppError('This link is invalid or has expired.', 400);
    await tx.account.deleteMany({ where: { userId: token.userId, provider } });
    await tx.user.update({
      where: { id: token.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    await tx.accountLoginSession.deleteMany({ where: { userId: token.userId } });
    await tx.authToken.deleteMany({
      where: { userId: token.userId, kind: { startsWith: 'unlink:' } },
    });
  });
}
