import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hash, verify } from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';

const state = vi.hoisted(() => ({
  userId: '',
  fail: false,
  messages: [] as { subject: string }[],
}));
vi.mock('../src/auth', () => ({
  auth: async () => (state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { subject: string }) => {
        if (state.fail) throw new Error('SMTP outcome unknown');
        state.messages.push(message);
      },
    }),
  },
}));
import { POST } from '../src/app/api/account/password/route';
import { sendOneSecurityNotice } from '../src/lib/security-notices';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('authenticated password changes', () => {
  const email = `password-${randomUUID()}@example.test`;
  const oldPassword = 'InitialPassword!2026';
  const newPassword = 'UpdatedPassword!2026';
  const origin = 'http://localhost:3000';
  const request = (currentPassword: string, password = newPassword, requestOrigin = origin) =>
    new Request(`${origin}/api/account/password`, {
      method: 'POST',
      headers: {
        origin: requestOrigin,
        'content-type': 'application/json',
        'x-forwarded-for': email,
      },
      body: JSON.stringify({ currentPassword, password, confirmPassword: password }),
    });
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    const user = await db.user.create({
      data: { email, passwordHash: await hash(oldPassword, { type: 2 }) },
    });
    state.userId = user.id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('requires a session and same-origin request and rejects an incorrect password', async () => {
    const userId = state.userId;
    state.userId = '';
    expect((await POST(request(oldPassword))).status).toBe(401);
    state.userId = userId;
    expect((await POST(request(oldPassword, newPassword, 'https://attacker.example'))).status).toBe(
      403,
    );
    expect((await POST(request('wrong-password'))).status).toBe(400);
    expect(state.messages).toHaveLength(0);
  });
  it('allows one competing change, revokes sessions and reset tokens, and queues one notice', async () => {
    await db.authToken.create({
      data: {
        userId: state.userId,
        kind: 'reset',
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const responses = await Promise.all([
      POST(request(oldPassword)),
      POST(request(oldPassword, 'DifferentPassword!2026')),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409 || response.status === 400),
    ).toHaveLength(1);
    const user = await db.user.findUniqueOrThrow({ where: { id: state.userId } });
    expect(user.sessionVersion).toBe(1);
    expect(await verify(user.passwordHash!, oldPassword)).toBe(false);
    expect(await db.authToken.count({ where: { userId: state.userId, kind: 'reset' } })).toBe(0);
    expect(
      await db.securityNotice.count({ where: { ownerId: state.userId, status: 'pending' } }),
    ).toBe(1);
    expect(state.messages).toHaveLength(0);
    expect(await sendOneSecurityNotice()).toBe(true);
    expect(
      await db.securityNotice.count({ where: { ownerId: state.userId, status: 'sent' } }),
    ).toBe(1);
    expect(state.messages.map((message) => message.subject)).toEqual([
      'Your Assame password was changed',
    ]);
  });
  it('keeps an uncertain SMTP outcome for review without resending', async () => {
    const notice = await db.securityNotice.create({
      data: { ownerId: state.userId, kind: 'password_changed' },
    });
    state.fail = true;
    expect(await sendOneSecurityNotice()).toBe(true);
    state.fail = false;
    expect((await db.securityNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe(
      'unverified',
    );
    expect(await sendOneSecurityNotice()).toBe(false);
    expect(state.messages).toHaveLength(1);
  });
});
