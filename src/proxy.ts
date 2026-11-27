import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { auth } from '@/auth';
import { db } from '@/lib/db';

const hint = 'assame-account-theme';

function privateResponse() {
  const response = NextResponse.next();
  // Never let a shared cache replay a user's theme hint to another visitor.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function clearHint(response: NextResponse) {
  response.cookies.set(hint, '', { path: '/', maxAge: 0, sameSite: 'lax' });
  return response;
}

// Auth.js validates the JWT and the server-backed login session before exposing
// req.auth. The hint contains no identifier and is used only for appearance.
const authenticated = auth(async (request: NextAuthRequest, _event: NextFetchEvent) => {
  void _event;
  const response = privateResponse();
  const userId = request.auth?.user?.id;
  if (!userId) return clearHint(response);
  const saved = await db.userPreference.findUnique({ where: { userId }, select: { theme: true } });
  const theme = saved?.theme;
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return clearHint(response);
  response.cookies.set(hint, theme, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  });
  return response;
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const hasSession = request.cookies
    .getAll()
    .some(({ name }) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(name));
  if (!hasSession) {
    // A prior sign-out must not apply one account's hint to an anonymous visit.
    return request.cookies.has(hint) ? clearHint(privateResponse()) : NextResponse.next();
  }
  try {
    return await authenticated(request, event);
  } catch {
    // Public content remains available if account/session storage is unavailable.
    return clearHint(privateResponse());
  }
}

export const config = {
  matcher: [
    '/',
    '/about',
    '/features',
    '/integrations/:path*',
    '/contact',
    '/faq',
    '/privacy',
    '/terms',
    '/blog/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/confirm-sign-in-removal',
    '/oauth-complete',
    '/confirm-account-removal',
    '/overview',
    '/domains/:path*',
    '/listings',
    '/registrars',
    '/sales',
    '/renewals',
    '/analytics',
    '/sync',
    '/connections',
    '/settings',
    '/account/:path*',
  ],
};
