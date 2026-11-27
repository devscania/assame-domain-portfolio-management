import { z } from 'zod';
import { auth } from '@/auth';
import { requestAccountRemoval, confirmAccountRemoval } from '@/lib/account-removal-email';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export const runtime = 'nodejs';
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }).strict(),
  z
    .object({
      action: z.literal('confirm'),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      confirmation: z.literal('DELETE ACCOUNT'),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    const userId = session?.user?.id;
    const sessionId = (session as typeof session & { loginSessionId?: string })?.loginSessionId;
    if (!userId || !sessionId) throw new AppError('Sign in required.', 401);
    const body = input.parse(await readJson(request, 4096));
    await throttle(`account-removal:${userId}`, 5);
    await throttle(
      `account-removal-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      30,
    );
    if (body.action === 'request') await requestAccountRemoval(userId, sessionId);
    else await confirmAccountRemoval(userId, sessionId, body.token);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError ? error.message : 'Unable to complete account removal request.',
      },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
