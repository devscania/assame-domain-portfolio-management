import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const state = vi.hoisted(() => ({ userId: '', sessionId: '' }));
vi.mock('@/auth', () => ({ auth: async () => state.userId ? { user: { id: state.userId }, loginSessionId: state.sessionId } : null }));
import { POST } from '../src/app/api/analytics/oauth-signup/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('OAuth signup analytics claim', () => {
  let userId = '', sessionId = '', otherId = '';
  const origin = 'http://localhost:3010';
  function request(method: string, from = origin) {
    return new Request(`${origin}/api/analytics/oauth-signup`, { method: 'POST', headers: { origin: from, cookie: `assame-oauth-analytics=${method}`, 'content-type': 'application/json' }, body: JSON.stringify({ method }) });
  }
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error('Dedicated test database required');
    vi.stubEnv('AUTH_URL', origin);
    const user = await db.user.create({ data: { email: `oauth-analytics-${randomUUID()}@example.test` } });
    const other = await db.user.create({ data: { email: `oauth-analytics-${randomUUID()}@example.test` } });
    userId = user.id; otherId = other.id; sessionId = randomUUID();
    await db.accountLoginSession.create({ data: { id: sessionId, userId, method: 'google', sessionVersion: 0, oauthSignupPending: true, expiresAt: new Date(Date.now() + 60000) } });
    state.userId = userId; state.sessionId = sessionId;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.$disconnect();
  });
  it('requires the exact active session and provider, and claims once under concurrency', async () => {
    expect((await POST(request('google', 'https://foreign.example'))).status).toBe(403);
    expect(await (await POST(request('discord'))).json()).toEqual({ status: 'none' });
    state.userId = otherId;
    expect(await (await POST(request('google'))).json()).toEqual({ status: 'none' });
    state.userId = userId;
    const results = await Promise.all([POST(request('google')), POST(request('google'))]);
    expect(await Promise.all(results.map((r) => r.json()))).toEqual(expect.arrayContaining([{ status: 'claimed' }, { status: 'none' }]));
    expect(results[0].headers.get('cache-control')).toBe('private, no-store');
  });
});
