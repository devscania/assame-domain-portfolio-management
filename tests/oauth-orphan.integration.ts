import 'dotenv/config';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; loginSessionId: string },
  messages: [] as string[],
}));
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { text: string }) => {
        state.messages.push(m.text);
      },
    }),
  },
}));
vi.mock('@/auth', async (importOriginal) => {
  const a = await importOriginal<typeof import('../src/auth')>();
  return { ...a, auth: vi.fn(async () => state.session) };
});
const base = 'http://localhost:3010';
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
describe.skipIf(!process.env.TEST_DATABASE_URL)('real Auth.js OAuth orphan callback race', () => {
  it('denies a paused signup after recovery and permits an explicitly guarded link', async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw Error('Dedicated test database required');
    vi.stubEnv('AUTH_URL', base);
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(64));
    vi.stubEnv('AUTH_GOOGLE_ID', 'client');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'secret');
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('SMTP_FROM', 'test@example.test');
    const email = `orphan-${randomUUID()}@example.test`;
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { kid: 'synthetic', alg: 'RS256', use: 'sig' });
    let nonce = '';
    let waitToken: Promise<void> | null = null;
    let tokenStarted: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const u = String(input);
        if (u.includes('.well-known'))
          return Response.json({
            issuer: 'https://accounts.google.com',
            authorization_endpoint: 'https://accounts.google.com/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            jwks_uri: 'https://www.googleapis.com/jwks',
            userinfo_endpoint: 'https://openidconnect.googleapis.com/userinfo',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
            id_token_signing_alg_values_supported: ['RS256'],
          });
        if (u.includes('/jwks')) return Response.json({ keys: [jwk] });
        if (u.includes('/token')) {
          if (waitToken) {
            tokenStarted?.();
            await waitToken;
            waitToken = null;
          }
          const now = Math.floor(Date.now() / 1000);
          const jwt = new SignJWT({
            email,
            email_verified: true,
            name: 'Fixture',
            ...(nonce ? { nonce } : {}),
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
            .setIssuer('https://accounts.google.com')
            .setAudience('client')
            .setSubject('synthetic-subject')
            .setIssuedAt(now)
            .setExpirationTime(now + 300);
          return Response.json({
            access_token: 'fake',
            token_type: 'Bearer',
            id_token: await jwt.sign(privateKey),
            expires_in: 300,
          });
        }
        throw Error('unexpected fake URL ' + u);
      }),
    );
    const { handlers } = await import('../src/auth');
    const { GET } = await import('../src/app/api/auth/[...nextauth]/route');
    const { POST: emailRoute } = await import('../src/app/api/auth-email/route');
    const { oauthAdapter } = await import('../src/lib/oauth-adapter');
    const { db } = await import('../src/lib/db');
    let userId = '';
    let release!: () => void;
    let created!: (id: string) => void;
    const ready = new Promise<string>((r) => (created = r));
    const hold = new Promise<void>((r) => (release = r));
    const original = oauthAdapter.createUser!;
    const spy = vi.spyOn(oauthAdapter, 'createUser').mockImplementation(async (p) => {
      const user = await original(p);
      created(user.id);
      await hold;
      return user;
    });
    async function start(extra = '') {
      const csrf = await handlers.GET(
        new NextRequest(`${base}/api/auth/csrf`, { headers: { cookie: extra } }),
      );
      const body = await csrf.json();
      const csrfCookies = cookies(csrf);
      const res = await handlers.POST(
        new NextRequest(`${base}/api/auth/signin/google`, {
          method: 'POST',
          headers: {
            cookie: [extra, csrfCookies].filter(Boolean).join('; '),
            'content-type': 'application/x-www-form-urlencoded',
            origin: base,
          },
          body: new URLSearchParams({ csrfToken: body.csrfToken, callbackUrl: '/overview' }),
        }),
      );
      const url = new URL(res.headers.get('location')!);
      nonce = url.searchParams.get('nonce') || '';
      return { url, cookie: [extra, csrfCookies, cookies(res)].filter(Boolean).join('; ') };
    }
    function cb(started: { url: URL; cookie: string }, more = '') {
      const u = new URL(`${base}/api/auth/callback/google`);
      u.searchParams.set('code', 'synthetic-code');
      u.searchParams.set('state', started.url.searchParams.get('state')!);
      return new NextRequest(u, {
        headers: { cookie: [started.cookie, more].filter(Boolean).join('; ') },
      });
    }
    try {
      const first = await start();
      const delayed = GET(cb(first));
      userId = await Promise.race([
        ready,
        delayed.then((r) => {
          throw Error('callback ended early: ' + r.headers.get('location'));
        }),
      ]);
      const request = (body: object) =>
        new Request(`${base}/api/auth-email`, {
          method: 'POST',
          headers: {
            origin: base,
            'content-type': 'application/json',
            'x-forwarded-for': randomUUID(),
          },
          body: JSON.stringify(body),
        });
      expect((await emailRoute(request({ action: 'request-reset', email }))).status).toBe(200);
      const link = state.messages.at(-1)?.match(/https?:\/\/\S+/)?.[0];
      expect(link).toBeTruthy();
      const token = new URL(link!).searchParams.get('token');
      expect(
        (
          await emailRoute(
            request({
              action: 'reset',
              token,
              password: 'another-strong-password-456',
              confirmPassword: 'another-strong-password-456',
            }),
          )
        ).status,
      ).toBe(200);
      release();
      const blocked = await delayed;
      expect(blocked.status).toBe(302);
      expect(await db.account.count({ where: { userId } })).toBe(0);
      expect((await db.oAuthSignupPending.findUniqueOrThrow({ where: { userId } })).recovered).toBe(
        true,
      );
      spy.mockRestore();
      const { createLoginSession } = await import('../src/lib/login-sessions');
      const { encode } = await import('next-auth/jwt');
      const { createOAuthLinkIntent, linkCookie } = await import('../src/lib/oauth-link');
      const login = await createLoginSession(userId, 1, 'credentials');
      expect(login).toBeTruthy();
      const jwt = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: 'authjs.session-token',
        token: { sub: userId, sessionVersion: 1, loginSessionId: login!.id },
      });
      state.session = { user: { id: userId }, loginSessionId: login!.id };
      const sessionCookie = `authjs.session-token=${jwt}`;
      const second = await start(sessionCookie);
      const staleIntent = await createOAuthLinkIntent(userId, 'google');
      let tokenReady!: () => void;
      const tokenArrived = new Promise<void>((r) => (tokenReady = r));
      let releaseToken!: () => void;
      waitToken = new Promise<void>((r) => (releaseToken = r));
      tokenStarted = tokenReady;
      const revoked = GET(cb(second, `${linkCookie}=${staleIntent}`));
      await tokenArrived;
      await db.accountLoginSession.delete({ where: { id: login!.id } });
      releaseToken();
      expect((await revoked).status).toBe(302);
      expect(await db.account.count({ where: { userId } })).toBe(0);
      const fresh = await createLoginSession(userId, 1, 'credentials');
      expect(fresh).toBeTruthy();
      const freshJwt = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: 'authjs.session-token',
        token: { sub: userId, sessionVersion: 1, loginSessionId: fresh!.id },
      });
      state.session = { user: { id: userId }, loginSessionId: fresh!.id };
      const third = await start(`authjs.session-token=${freshJwt}`);
      const intent = await createOAuthLinkIntent(userId, 'google');
      const linked = await GET(cb(third, `${linkCookie}=${intent}`));
      expect(linked.status).toBe(302);
      expect(await db.account.count({ where: { userId, provider: 'google' } })).toBe(1);
      expect(await db.oAuthSignupPending.findUnique({ where: { userId } })).toBeNull();
    } finally {
      release();
      spy.mockRestore();
      if (userId) {
        await db.organization.deleteMany({ where: { workspaceOwnerId: userId } });
        await db.user.deleteMany({ where: { id: userId } });
      }
      await db.$disconnect();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }, 30000);
});
