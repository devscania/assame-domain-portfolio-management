import { hash } from 'argon2';
import { z } from 'zod';
import { db } from '@/lib/db';
import { assertOrigin, AppError, logger, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { emailConfigured, sendAuthLink } from '@/lib/auth-email';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (!emailConfigured())
      throw new AppError('Registration is unavailable until email is configured', 503);
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(128),
        confirmPassword: z.string().min(12).max(128),
        name: z.string().trim().max(100).optional(),
        workspace: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(await readJson(request, 16384));
    if (input.password !== input.confirmPassword) throw new AppError('Passwords do not match');
    await throttle(`register:${input.email}`);
    await throttle(
      `registration-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      15,
    );
    await throttle('registration:global', 1000);
    const passwordHash = await hash(input.password, { type: 2 });
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name || null,
          passwordHash,
          verificationRequired: true,
        },
      });
      await tx.organization.create({
        data: {
          name: input.workspace || 'My portfolio',
          workspaceOwnerId: user.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      return user;
    });
    // The account remains unverified if delivery fails; the user can request another link.
    await sendAuthLink(user, 'verify').catch(() =>
      logger.error('Verification email delivery failed'),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : 'Unable to register. Check your inputs or sign in to an existing account.',
      },
      { status: e instanceof AppError ? e.status : 400 },
    );
  }
}
