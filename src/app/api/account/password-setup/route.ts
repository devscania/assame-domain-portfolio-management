import { auth } from '@/auth';
import { db } from '@/lib/db';
import { sendAuthLink } from '@/lib/auth-email';
import { AppError, assertOrigin, logger } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    await throttle(`password-setup:${session.user.id}`, 5);
    await throttle(
      `password-setup-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      30,
    );
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true },
    });
    if (!user) throw new AppError('Sign in required', 401);
    await sendAuthLink(user, 'setup');
    return Response.json({ ok: true });
  } catch (error) {
    if (!(error instanceof AppError)) logger.error('Password setup email delivery failed');
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Unable to send the setup email. Please try again.',
      },
      { status: error instanceof AppError ? error.status : 503 },
    );
  }
}
