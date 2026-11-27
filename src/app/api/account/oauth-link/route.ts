import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { createOAuthLinkIntent, linkCookie } from '@/lib/oauth-link';
import { isOAuthProvider, providerEnabled } from '@/lib/oauth-policy';
import { assertOrigin, AppError, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const { provider } = z.object({ provider: z.string() }).parse(await readJson(request, 4096));
    if (!isOAuthProvider(provider) || !providerEnabled(provider))
      throw new AppError('Provider unavailable', 400);
    await throttle(`oauth-link:${session.user.id}`, 10);
    const token = await createOAuthLinkIntent(session.user.id, provider);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(linkCookie, token, {
      httpOnly: true,
      secure: new URL(process.env.AUTH_URL || request.url).protocol === 'https:',
      sameSite: 'lax',
      path: `/api/auth/callback/${provider}`,
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof AppError ? error.message : 'Unable to start linking.' },
      { status: error instanceof AppError ? error.status : 400 },
    );
  }
}
