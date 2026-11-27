import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { deleteAccountLocked } from './account-security';
import { emailConfigured, hashAuthToken, sendAccountRemovalLink } from './auth-email';
import { AppError } from './security';

async function assertSession(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  // Serialize against session revocation while consuming the token.
  await tx.$queryRaw`SELECT id FROM "AccountLoginSession" WHERE id = ${sessionId} FOR UPDATE`;
  const session = await tx.accountLoginSession.findFirst({
    where: { id: sessionId, userId, expiresAt: { gt: new Date() } },
    select: { sessionVersion: true },
  });
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      emailVerified: true,
      passwordHash: true,
      sessionVersion: true,
      deletedAt: true,
    },
  });
  if (
    !session ||
    !user ||
    user.deletedAt ||
    !user.emailVerified ||
    user.passwordHash ||
    session.sessionVersion !== user.sessionVersion
  )
    throw new AppError('This request is unavailable. Sign in again and try again.', 409);
  return user;
}

export async function requestAccountRemoval(userId: string, sessionId: string) {
  if (!emailConfigured()) throw new AppError('Email service is not configured.', 503);
  const raw = randomBytes(32).toString('base64url');
  const email = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await assertSession(tx, userId, sessionId);
    await tx.authToken.deleteMany({ where: { userId, kind: { startsWith: 'account-removal:' } } });
    await tx.authToken.create({
      data: {
        userId,
        kind: `account-removal:${user.sessionVersion}:${sessionId}`,
        tokenHash: hashAuthToken(raw),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return user.email;
  });
  await sendAccountRemovalLink(email, raw);
}

export async function confirmAccountRemoval(userId: string, sessionId: string, raw: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await assertSession(tx, userId, sessionId);
    const token = await tx.authToken.findUnique({ where: { tokenHash: hashAuthToken(raw) } });
    if (
      !token ||
      token.userId !== userId ||
      token.kind !== `account-removal:${user.sessionVersion}:${sessionId}` ||
      token.expiresAt <= new Date()
    )
      throw new AppError(
        'This link is invalid or has expired. Open it in the same signed-in browser.',
        400,
      );
    // The deletion and token consumption commit together.
    await tx.authToken.delete({ where: { id: token.id } });
    await deleteAccountLocked(tx, userId);
  });
}
