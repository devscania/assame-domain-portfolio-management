import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const state = vi.hoisted(() => ({
  userId: '',
  sessionId: 'current-session',
  intentAccepted: false,
  calls: 0,
}));
vi.mock('../src/auth', () => ({
  auth: async () =>
    state.userId ? { user: { id: state.userId }, loginSessionId: state.sessionId } : null,
  handlers: {
    GET: async () => {
      state.calls++;
      return NextResponse.json({ ok: true });
    },
    POST: async () => {
      state.calls++;
      return NextResponse.json({ ok: true });
    },
  },
}));
vi.mock('../src/lib/oauth-link', () => ({
  linkCookie: 'assame.oauth-link',
  consumeOAuthLinkIntent: async () => state.intentAccepted,
}));
import { GET, POST } from '../src/app/api/auth/[...nextauth]/route';

describe('OAuth callback linking guard', () => {
  function request(method: string, cookie = '') {
    return new NextRequest('https://portfolio.example.test/api/auth/callback/google', {
      method,
      headers: { cookie },
    });
  }
  it('allows unauthenticated OAuth callbacks through to Auth.js', async () => {
    state.calls = 0;
    state.userId = '';
    expect((await GET(request('GET'))).status).toBe(200);
    expect(state.calls).toBe(1);
  });
  it('blocks existing or revoked session cookies without explicit linking, for GET and POST', async () => {
    state.calls = 0;
    state.userId = 'user';
    state.intentAccepted = false;
    expect((await GET(request('GET', 'authjs.session-token=abc'))).status).toBe(307);
    expect((await POST(request('POST', '__Secure-authjs.session-token.0=abc'))).status).toBe(307);
    state.userId = '';
    expect((await GET(request('GET', 'authjs.session-token.attacker-suffix=abc'))).status).toBe(
      307,
    );
    expect(
      (
        await GET(
          new NextRequest('https://portfolio.example.test/api/auth/callback/google/', {
            headers: { cookie: 'authjs.session-token=abc' },
          }),
        )
      ).status,
    ).toBe(307);
    expect(state.calls).toBe(0);
  });
  it('allows an explicitly authorized link with a current session', async () => {
    state.calls = 0;
    state.userId = 'user';
    state.intentAccepted = true;
    expect(
      (await GET(request('GET', 'authjs.session-token=abc; assame.oauth-link=token'))).status,
    ).toBe(200);
    expect(state.calls).toBe(1);
    state.sessionId = '';
    expect(
      (await GET(request('GET', 'authjs.session-token=abc; assame.oauth-link=token'))).status,
    ).toBe(307);
    expect(state.calls).toBe(1);
    state.sessionId = 'current-session';
  });
});
