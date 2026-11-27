import { z } from 'zod';
import { auth } from '@/auth';
import { requestSignInRemoval, confirmSignInRemoval } from '@/lib/oauth-removal';
import { isOAuthProvider } from '@/lib/oauth-policy';
import { AppError, assertOrigin, logger, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export const runtime = 'nodejs';
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), provider: z.string().max(50) }),
  z.object({ action: z.literal('confirm'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const input = inputSchema.parse(await readJson(request, 4096));
    await throttle(
      `oauth-removal-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      30,
    );
    if (input.action === 'request') {
      const session = await auth();
      if (!session?.user?.id) throw new AppError('Sign in required', 401);
      if (!isOAuthProvider(input.provider)) throw new AppError('Unknown sign-in method', 400);
      await throttle(`oauth-removal:${session.user.id}`, 5);
      await requestSignInRemoval(session.user.id, input.provider);
    } else {
      await confirmSignInRemoval(input.token);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof z.ZodError))
      logger.error('Sign-in removal failed');
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Unable to complete this request. Please try again.',
      },
      {
        status: error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503,
      },
    );
  }
}
