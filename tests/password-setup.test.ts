import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verify } from 'argon2';
import { db } from '../src/lib/db';
const fixture = vi.hoisted(() => ({ userId: '', messages: [] as { text: string }[] }));
vi.mock('../src/auth', () => ({
  auth: async () => (fixture.userId ? { user: { id: fixture.userId } } : null),
}));
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { text: string }) => {
        fixture.messages.push(message);
      },
    }),
  },
}));
import { POST as requestSetup } from '../src/app/api/account/password-setup/route';
import { POST as authEmail } from '../src/app/api/auth-email/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('OAuth account password setup', () => {
  let userId = '';
  const origin = 'http://localhost:3010';
  const email = `setup-${randomUUID()}@example.test`;
  const setupRequest = (requestOrigin = origin) =>
    new Request(`${origin}/api/account/password-setup`, {
      method: 'POST',
      headers: { origin: requestOrigin, 'x-forwarded-for': email },
    });
  const resetRequest = (token: string) =>
    new Request(`${origin}/api/auth-email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': email },
      body: JSON.stringify({
        action: 'reset',
        token,
        password: 'a-strong-password-123',
        confirmPassword: 'a-strong-password-123',
      }),
    });
  const lastToken = () =>
    new URL(fixture.messages.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    const user = await db.user.create({
      data: {
        email,
        emailVerified: new Date(),
        accounts: {
          create: { type: 'oauth', provider: 'google', providerAccountId: randomUUID() },
        },

        ownedWorkspaces: { create: { name: 'Existing portfolio' } },
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { workspaceOwnerId: userId } });
    await db.user.deleteMany({ where: { id: userId } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('requires a signed-in session and same-origin request', async () => {
    fixture.userId = '';
    expect((await requestSetup(setupRequest())).status).toBe(401);
    fixture.userId = userId;
    expect((await requestSetup(setupRequest('https://attacker.example'))).status).toBe(403);
    expect(fixture.messages).toHaveLength(0);
  });
  it('requires verified email and invalidates a link when sessions are revoked', async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerified: null } });
    expect((await requestSetup(setupRequest())).status).toBe(409);
    await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    expect((await requestSetup(setupRequest())).status).toBe(200);
    const stale = lastToken();
    await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    expect((await authEmail(resetRequest(stale))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBeNull();
  });
  it('sets a password once while retaining the OAuth identity and workspace', async () => {
    expect((await requestSetup(setupRequest())).status).toBe(200);
    const token = lastToken();
    const responses = await Promise.all([
      authEmail(resetRequest(token)),
      authEmail(resetRequest(token)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true, ownedWorkspaces: true },
    });
    expect(await verify(user.passwordHash!, 'a-strong-password-123')).toBe(true);
    expect(user.sessionVersion).toBe(2);
    expect(user.accounts[0].provider).toBe('google');
    expect(user.ownedWorkspaces[0].name).toBe('Existing portfolio');
    expect((await requestSetup(setupRequest())).status).toBe(409);
  });
});
