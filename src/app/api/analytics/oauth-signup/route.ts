import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    const userId = session?.user?.id;
    const sessionId = (session as typeof session & { loginSessionId?: string })?.loginSessionId;
    if (!userId || !sessionId) throw new AppError('Sign in required.', 401);
    const { method } = z.object({ method: z.enum(['google', 'discord']) }).strict().parse(await readJson(request, 1024));
    const consentHint = request.headers.get('cookie')?.match(/(?:^|;\s*)assame-oauth-analytics=(google|discord)(?:;|$)/)?.[1];
    if (consentHint !== method) return Response.json({ status: 'none' }, { headers });
    await throttle(`oauth-signup-analytics:${userId}`, 30);
    const claimed = await db.$queryRaw<{ method: string }[]>`
      UPDATE "AccountLoginSession" s SET "oauthSignupPending" = false
      FROM "User" u
      WHERE s.id = ${sessionId} AND s."userId" = ${userId} AND u.id = s."userId"
        AND u."deletedAt" IS NULL AND s."sessionVersion" = u."sessionVersion"
        AND s."expiresAt" > NOW() AND s."createdAt" > NOW() - INTERVAL '1 hour'
        AND s."oauthSignupPending" = true AND s.method = ${method}
      RETURNING s.method`;
    return Response.json({ status: claimed.length ? 'claimed' : 'none' }, { headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json({ error: status === 401 ? 'Sign in required.' : 'Analytics unavailable.' }, { status, headers });
  }
}
