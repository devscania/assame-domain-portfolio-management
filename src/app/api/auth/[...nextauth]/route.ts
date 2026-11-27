import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth, handlers } from '@/auth';
import { consumeOAuthLinkIntent, linkCookie } from '@/lib/oauth-link';
import { isOAuthProvider } from '@/lib/oauth-policy';
import { runGuardedOAuthLink } from '@/lib/oauth-link-context';

async function guardedHandler(request: NextRequest, method: 'GET' | 'POST') {
  const segments = request.nextUrl.pathname
    .replace(/^\/api\/auth/, '')
    .split('/')
    .filter(Boolean);
  const provider = segments.length === 2 && segments[0] === 'callback' ? segments[1] : '';
  if (isOAuthProvider(provider)) {
    // Auth.js decodes its session cookie directly during account linking. Require a
    // currently valid session and an explicit one-use intent before it can do so.
    const hasSessionCookie = request.cookies
      .getAll()
      .some(
        ({ name }) =>
          name.startsWith('authjs.session-token') ||
          name.startsWith('__Secure-authjs.session-token'),
      );
    if (hasSessionCookie) {
      const session = await auth();
      const sessionId = (session as typeof session & { loginSessionId?: string })?.loginSessionId;
      if (
        !session?.user?.id ||
        !sessionId ||
        !(await consumeOAuthLinkIntent(
          session.user.id,
          provider,
          request.cookies.get(linkCookie)?.value,
        ))
      ) {
        return NextResponse.redirect(new URL('/login?error=OAuthLinkRequired', request.url));
      }
      return runGuardedOAuthLink({ userId: session.user.id, sessionId, provider }, () =>
        handlers[method](request),
      );
    }
  }
  return handlers[method](request);
}
export const GET = (request: NextRequest) => guardedHandler(request, 'GET');
export const POST = (request: NextRequest) => guardedHandler(request, 'POST');
