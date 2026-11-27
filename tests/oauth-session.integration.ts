import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const base = 'http://localhost:3010';
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');

describe.skipIf(!process.env.TEST_DATABASE_URL)('actual OAuth callback session persistence', () => {
  it('persists first and repeat verified Google and Discord sign-ins through the real adapter and JWT session', async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated database required');
    vi.stubEnv('AUTH_URL', base);
    vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-fixture-only'.repeat(2));
    for (const provider of ['GOOGLE', 'DISCORD']) {
      vi.stubEnv(`AUTH_${provider}_ID`, 'fixture-client');
      vi.stubEnv(`AUTH_${provider}_SECRET`, 'fixture-secret');
    }
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { kid: 'fixture', alg: 'RS256', use: 'sig' });
    let provider = 'google';
    let nonce = '';
    const fixtureId = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('.well-known'))
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
        if (url.includes('/jwks')) return Response.json({ keys: [jwk] });
        if (url.includes('/token')) {
          if (provider === 'discord')
            return Response.json({
              access_token: 'fixture-access',
              token_type: 'Bearer',
              expires_in: 3600,
            });
          const now = Math.floor(Date.now() / 1000);
          const jwt = await new SignJWT({
            email: `google-${fixtureId}@example.test`,
            email_verified: true,
            name: 'Google fixture',
            ...(nonce ? { nonce } : {}),
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
            .setIssuer('https://accounts.google.com')
            .setAudience('fixture-client')
            .setSubject(`google-${fixtureId}`)
            .setIssuedAt(now)
            .setExpirationTime(now + 3600)
            .sign(privateKey);
          return Response.json({
            access_token: 'fixture-access',
            token_type: 'Bearer',
            id_token: jwt,
            expires_in: 3600,
          });
        }
        if (url === 'https://discord.com/api/users/@me')
          return Response.json({
            id: `discord-${fixtureId}`,
            email: `discord-${fixtureId}@example.test`,
            verified: true,
            username: 'Discord fixture',
          });
        throw new Error('Unexpected mocked provider request');
      }),
    );
    const { handlers } = await import('../src/auth');
    const { db } = await import('../src/lib/db');
    try {
      for (provider of ['google', 'discord']) {
        let firstId = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const csrf = await handlers.GET(new NextRequest(`${base}/api/auth/csrf`));
          const { csrfToken } = await csrf.json();
          const start = await handlers.POST(
            new NextRequest(`${base}/api/auth/signin/${provider}`, {
              method: 'POST',
              headers: {
                cookie: cookieHeader(csrf),
                'content-type': 'application/x-www-form-urlencoded',
                origin: base,
              },
              body: new URLSearchParams({ csrfToken, callbackUrl: '/overview' }),
            }),
          );
          const authorization = new URL(start.headers.get('location')!);
          nonce = authorization.searchParams.get('nonce') || '';
          const callback = new URL(`${base}/api/auth/callback/${provider}`);
          callback.searchParams.set('code', 'fixture-code');
          if (authorization.searchParams.has('state'))
            callback.searchParams.set('state', authorization.searchParams.get('state')!);
          if (provider === 'discord') callback.searchParams.set('iss', 'https://discord.com');
          const response = await handlers.GET(
            new NextRequest(callback, {
              headers: { cookie: cookieHeader(start) },
            }),
          );
          expect(response.headers.get('location')).toBe(`${base}/overview`);
          const sessionCookie = cookieHeader(response);
          expect(sessionCookie).toContain('authjs.session-token=');
          const sessionResponse = await handlers.GET(
            new NextRequest(`${base}/api/auth/session`, { headers: { cookie: sessionCookie } }),
          );
          const session = await sessionResponse.json();
          expect(session.user?.id).toBeTruthy();
          if (!firstId) {
            firstId = session.user.id;
          } else expect(session.user.id).toBe(firstId);
          expect(
            await db.accountLoginSession.count({ where: { userId: firstId, method: provider } }),
          ).toBe(attempt + 1);
          expect(await db.organization.count({ where: { workspaceOwnerId: firstId } })).toBe(1);
          const sessionAgain = await handlers.GET(
            new NextRequest(`${base}/api/auth/session`, { headers: { cookie: sessionCookie } }),
          );
          expect((await sessionAgain.json()).user?.id).toBe(firstId);
          const persisted = await db.accountLoginSession.findMany({ where: { userId: firstId } });
          expect(
            persisted.every((row) => row.expiresAt.getTime() > Date.now() + 7.9 * 60 * 60 * 1000),
          ).toBe(true);
          if (attempt === 1) {
            await db.accountLoginSession.deleteMany({ where: { userId: firstId } });
            const revoked = await handlers.GET(
              new NextRequest(`${base}/api/auth/session`, { headers: { cookie: sessionCookie } }),
            );
            expect((await revoked.json())?.user).toBeUndefined();
          }
        }
      }
    } finally {
      const created = await db.user.findMany({
        where: {
          email: { in: [`google-${fixtureId}@example.test`, `discord-${fixtureId}@example.test`] },
        },
        select: { id: true },
      });
      for (const { id } of created) {
        await db.organization.deleteMany({ where: { workspaceOwnerId: id } });
        await db.user.delete({ where: { id } });
      }
      await db.$disconnect();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
