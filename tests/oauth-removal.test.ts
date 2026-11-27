import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const state = vi.hoisted(() => ({ userId: '', messages: [] as { text: string }[] }));
vi.mock('../src/auth', () => ({
  auth: async () => (state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { text: string }) => {
        state.messages.push(message);
      },
    }),
  },
}));
import { POST } from '../src/app/api/account/oauth-removal/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('removing linked sign-in methods', () => {
  let id = '',
    otherId = '';
  const origin = 'http://localhost:3010';
  const suffix = randomUUID();
  const request = (body: object, requestOrigin = origin) =>
    new Request(`${origin}/api/account/oauth-removal`, {
      method: 'POST',
      headers: {
        origin: requestOrigin,
        'content-type': 'application/json',
        'x-forwarded-for': suffix,
      },
      body: JSON.stringify(body),
    });
  const token = () =>
    new URL(state.messages.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  const add = (userId: string, provider: string) =>
    db.account.create({
      data: { userId, type: 'oauth', provider, providerAccountId: randomUUID() },
    });
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    vi.stubEnv('AUTH_GOOGLE_ID', 'test');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'test');
    vi.stubEnv('AUTH_DISCORD_ID', 'test');
    vi.stubEnv('AUTH_DISCORD_SECRET', 'test');
    const users = await Promise.all(
      ['user', 'other'].map((prefix) =>
        db.user.create({
          data: { email: `${prefix}-${suffix}@example.test`, emailVerified: new Date() },
        }),
      ),
    );
    [id, otherId] = users.map((user) => user.id);
  });
  beforeEach(async () => {
    state.userId = id;
    state.messages.length = 0;
    await db.authThrottle.deleteMany({
      where: {
        key: {
          in: [`oauth-removal:${id}`, `oauth-removal-address:${suffix}`].map((key) =>
            createHash('sha256').update(key).digest('hex'),
          ),
        },
      },
    });
    await db.authToken.deleteMany({ where: { userId: id } });
    await db.account.deleteMany({ where: { userId: { in: [id, otherId] } } });
    await db.user.update({
      where: { id },
      data: { passwordHash: null, emailVerified: new Date(), sessionVersion: 0 },
    });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [id, otherId] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('requires authentication, same origin and another usable sign-in method', async () => {
    await add(id, 'google');
    await add(otherId, 'discord');
    state.userId = '';
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(401);
    state.userId = id;
    expect(
      (await POST(request({ action: 'request', provider: 'google' }, 'https://attacker.example')))
        .status,
    ).toBe(403);
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(409);
    expect((await POST(request({ action: 'request', provider: 'discord' }))).status).toBe(404);
    expect(state.messages).toHaveLength(0);
  });
  it('does not count a disabled provider and requires verified email', async () => {
    await add(id, 'google');
    await add(id, 'discord');
    vi.stubEnv('AUTH_DISCORD_ID', '');
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(409);
    vi.stubEnv('AUTH_DISCORD_ID', 'test');
    await db.user.update({ where: { id }, data: { emailVerified: null } });
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(409);
  });
  it('requires confirmation, revokes sessions, and consumes the token once', async () => {
    await add(id, 'google');
    await add(id, 'discord');
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(200);
    expect(await db.account.count({ where: { userId: id } })).toBe(2);
    const raw = token();
    const results = await Promise.all([
      POST(request({ action: 'confirm', token: raw })),
      POST(request({ action: 'confirm', token: raw })),
    ]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 400]);
    const user = await db.user.findUniqueOrThrow({ where: { id }, include: { accounts: true } });
    expect(user.sessionVersion).toBe(1);
    expect(user.accounts.map((account) => account.provider)).toEqual(['discord']);
  });
  it('rechecks alternatives and session version at confirmation', async () => {
    await add(id, 'google');
    await add(id, 'discord');
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(200);
    const raw = token();
    await db.account.deleteMany({ where: { userId: id, provider: 'discord' } });
    expect((await POST(request({ action: 'confirm', token: raw }))).status).toBe(409);
    expect(await db.account.count({ where: { userId: id, provider: 'google' } })).toBe(1);
    await add(id, 'discord');
    await db.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    expect((await POST(request({ action: 'confirm', token: raw }))).status).toBe(400);
  });
  it('rejects expired links without removing the provider', async () => {
    await add(id, 'google');
    await add(id, 'discord');
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(200);
    const raw = token();
    await db.authToken.updateMany({
      where: { userId: id, kind: { startsWith: 'unlink:' } },
      data: { expiresAt: new Date(0) },
    });
    expect((await POST(request({ action: 'confirm', token: raw }))).status).toBe(400);
    expect(await db.account.count({ where: { userId: id } })).toBe(2);
  });
  it('allows password users to remove their only connected provider', async () => {
    await add(id, 'google');
    await db.user.update({ where: { id }, data: { passwordHash: 'existing-hash' } });
    expect((await POST(request({ action: 'request', provider: 'google' }))).status).toBe(200);
    expect((await POST(request({ action: 'confirm', token: token() }))).status).toBe(200);
    expect(await db.account.count({ where: { userId: id } })).toBe(0);
  });
});
