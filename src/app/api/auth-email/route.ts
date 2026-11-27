import { z } from 'zod';
import { hash } from 'argon2';
import { db } from '@/lib/db';
import { emailConfigured, hashAuthToken, sendAuthLink } from '@/lib/auth-email';
import { AppError, assertOrigin, logger, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { queueWelcomeNotice } from '@/lib/welcome-notices';
import { queuePasswordChangedNotice } from '@/lib/security-notices';
import { isPristineOAuthOrphan } from '@/lib/oauth-orphan';

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const input = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('request-verify'), email: z.email().max(254) }),
        z.object({ action: z.literal('request-reset'), email: z.email().max(254) }),
        z.object({ action: z.literal('verify'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
        z.object({
          action: z.literal('reset'),
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          password: z.string().min(12).max(128),
          confirmPassword: z.string().min(12).max(128),
        }),
      ])
      .parse(await readJson(request, 16384));
    await throttle(
      `auth-email-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      30,
    );
    if (input.action === 'request-verify' || input.action === 'request-reset') {
      if (!emailConfigured()) throw new AppError('Email service is not configured', 503);
      const email = input.email.toLowerCase();
      await throttle(`auth-email:${email}`, 5);
      const user = await db.user.findUnique({ where: { email } });
      if (
        user &&
        !user.deletedAt &&
        (input.action === 'request-reset' ? Boolean(user.passwordHash) : !user.emailVerified)
      ) {
        await sendAuthLink(user, input.action === 'request-reset' ? 'reset' : 'verify').catch(() =>
          logger.error('Authentication email delivery failed'),
        );
      } else if (
        input.action === 'request-reset' &&
        user &&
        !user.deletedAt &&
        !user.passwordHash &&
        user.emailVerified &&
        (await db.oAuthSignupPending.findUnique({ where: { userId: user.id, recovered: false } }))
      ) {
        await sendAuthLink(user, 'orphan').catch(() =>
          logger.error('Authentication email delivery failed'),
        );
      }
      return Response.json({ ok: true });
    }
    if (input.action === 'reset' && input.password !== input.confirmPassword)
      throw new AppError('Passwords do not match');
    const tokenHash = hashAuthToken(input.token);
    const kind = input.action === 'reset' ? 'reset' : 'verify';
    const passwordHash = input.action === 'reset' ? await hash(input.password, { type: 2 }) : null;
    await db.$transaction(async (tx) => {
      const token = await tx.authToken.findUnique({ where: { tokenHash } });
      if (token) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${token.userId} FOR UPDATE`;
      const owner =
        token &&
        (await tx.user.findUnique({
          where: { id: token.userId },
          select: { deletedAt: true, emailVerified: true },
        }));
      const setup = kind === 'reset' && token?.kind.startsWith('setup:');
      const orphan = kind === 'reset' && token?.kind.startsWith('orphan:');
      if (
        !token ||
        !owner ||
        owner.deletedAt ||
        (token.kind !== kind && !setup && !orphan) ||
        token.expiresAt <= new Date()
      )
        throw new AppError('This link is invalid or has expired', 400);
      const consumed = await tx.authToken.deleteMany({
        where: { id: token.id, expiresAt: { gt: new Date() } },
      });
      if (consumed.count !== 1) throw new AppError('This link is invalid or has expired', 400);
      if (passwordHash) {
        if (orphan) {
          const version = Number(token.kind.slice('orphan:'.length));
          if (
            !Number.isSafeInteger(version) ||
            version < 0 ||
            !(await isPristineOAuthOrphan(tx, token.userId))
          )
            throw new AppError('This link is invalid or has expired', 400);
          const changed = await tx.user.updateMany({
            where: {
              id: token.userId,
              passwordHash: null,
              sessionVersion: version,
              emailVerified: { not: null },
            },
            data: { passwordHash, sessionVersion: { increment: 1 } },
          });
          if (changed.count !== 1) throw new AppError('This link is invalid or has expired', 400);
          await tx.oAuthSignupPending.update({
            where: { userId: token.userId },
            data: { recovered: true },
          });
          await tx.authToken.deleteMany({
            where: { userId: token.userId, kind: { startsWith: 'orphan:' } },
          });
          await queuePasswordChangedNotice(tx, token.userId);
          await queueWelcomeNotice(tx, token.userId);
          return;
        }
        if (setup) {
          const version = Number(token.kind.slice('setup:'.length));
          if (!Number.isSafeInteger(version) || version < 0)
            throw new AppError('This link is invalid or has expired', 400);
          const changed = await tx.user.updateMany({
            where: {
              id: token.userId,
              passwordHash: null,
              emailVerified: { not: null },
              sessionVersion: version,
            },
            data: { passwordHash, sessionVersion: { increment: 1 } },
          });
          if (changed.count !== 1) throw new AppError('This link is invalid or has expired', 400);
          await tx.accountLoginSession.deleteMany({ where: { userId: token.userId } });
          await tx.authToken.deleteMany({
            where: {
              userId: token.userId,
              OR: [{ kind: 'reset' }, { kind: { startsWith: 'setup:' } }],
            },
          });
          await queuePasswordChangedNotice(tx, token.userId);
          return;
        }
        await tx.user.update({
          where: { id: token.userId },
          data: { passwordHash, sessionVersion: { increment: 1 } },
          select: { email: true },
        });
        await tx.accountLoginSession.deleteMany({ where: { userId: token.userId } });
        await tx.authToken.deleteMany({
          where: {
            userId: token.userId,
            OR: [{ kind: 'reset' }, { kind: { startsWith: 'setup:' } }],
          },
        });
        await queuePasswordChangedNotice(tx, token.userId);
        return;
      } else {
        await tx.user.update({ where: { id: token.userId }, data: { emailVerified: new Date() } });
        if (!owner.emailVerified) await queueWelcomeNotice(tx, token.userId);
        await tx.authToken.deleteMany({ where: { userId: token.userId, kind: 'verify' } });
      }
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Unable to complete the request. Please try again.',
      },
      { status: error instanceof AppError ? error.status : 400 },
    );
  }
}
