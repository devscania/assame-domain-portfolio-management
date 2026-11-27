import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const state = vi.hoisted(() => ({ userId: '', sessionId: '' }));
vi.mock('../src/auth', () => ({
  auth: async () =>
    state.userId ? { user: { id: state.userId }, loginSessionId: state.sessionId } : null,
}));
import { PATCH } from '../src/app/api/account/profile/route';
import { GET, POST, DELETE } from '../src/app/api/account/sessions/route';
import { createLoginSession, validLoginSession } from '../src/lib/login-sessions';

describe.skipIf(!process.env.TEST_DATABASE_URL)('account profile and session controls', () => {
  let user = '',
    other = '';
  const origin = 'http://localhost:3010';
  const request = (method: string, body?: object, requestOrigin = origin) =>
    new Request(`${origin}/api/account/test`, {
      method,
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    const suffix = randomUUID();
    const users = await Promise.all(
      ['first', 'second'].map((prefix) =>
        db.user.create({
          data: {
            email: `${prefix}-${suffix}@example.test`,
            name: prefix,
          },
        }),
      ),
    );
    [user, other] = users.map((item) => item.id);
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [user, other] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('denies anonymous and cross-origin changes', async () => {
    state.userId = '';
    expect((await PATCH(request('PATCH', { name: 'New name' }))).status).toBe(401);
    expect((await POST(request('POST'))).status).toBe(401);
    state.userId = user;
    expect(
      (await PATCH(request('PATCH', { name: 'New name' }, 'https://attacker.example'))).status,
    ).toBe(403);
    expect((await POST(request('POST', undefined, 'https://attacker.example'))).status).toBe(403);
  });
  it('updates only the authenticated user name and validates input', async () => {
    state.userId = user;
    expect((await PATCH(request('PATCH', { name: '  Updated Name  ' }))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user } })).name).toBe('Updated Name');
    expect((await PATCH(request('PATCH', { name: 'Hacker', userId: other }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { name: '   ' }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { name: 'A\u0000B' }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { name: 'نام\u200cخانوادگی' }))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: other } })).name).toBe('second');
  });
  it('revokes all sessions only for the authenticated account', async () => {
    state.userId = user;
    const current = await createLoginSession(user, 0, 'credentials');
    const second = await createLoginSession(user, 0, 'credentials');
    const outsider = await createLoginSession(other, 0, 'credentials');
    state.sessionId = current!.id;
    const list = await GET();
    const rows = (await list.json()).sessions;
    expect(rows).toHaveLength(2);
    expect(rows.find((row: { id: string }) => row.id === current!.id).current).toBe(true);
    expect((await DELETE(request('DELETE', { id: outsider!.id }))).status).toBe(404);
    expect((await DELETE(request('DELETE', { id: second!.id }))).status).toBe(200);
    expect(await validLoginSession(user, second!.id, 0)).toBe(false);
    expect(await validLoginSession(user, current!.id, 0)).toBe(true);
    const response = await POST(request('POST'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await db.user.findUniqueOrThrow({ where: { id: user } })).sessionVersion).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: other } })).sessionVersion).toBe(0);
    expect(await validLoginSession(user, current!.id, 0)).toBe(false);
    expect(await validLoginSession(other, outsider!.id, 0)).toBe(true);
    expect(await createLoginSession(user, 0, 'credentials')).toBeNull();
  });
});
