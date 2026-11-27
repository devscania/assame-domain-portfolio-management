import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verify } from 'argon2';
import { db } from '../src/lib/db';

const messages = vi.hoisted(() => [] as { text: string }[]);
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { text: string }) => {
        messages.push(message);
      },
    }),
  },
}));
import { POST as register } from '../src/app/api/register/route';
import { POST as authEmail } from '../src/app/api/auth-email/route';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('verified email registration and recovery', () => {
  const email = `auth-${randomUUID()}@example.test`;
  let userId = '';
  let organizationId = '';
  const origin = 'http://localhost:3000';
  const testAddress = randomUUID();
  const request = (body: object) =>
    new Request(`${origin}/api/test`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': testAddress },
      body: JSON.stringify(body),
    });
  function tokenFromLastMessage() {
    const match = messages.at(-1)?.text.match(/https?:\/\/\S+/);
    expect(match).toBeTruthy();
    return new URL(match![0]).searchParams.get('token')!;
  }
  beforeAll(() => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    vi.stubEnv('WELCOME_EMAILS_ENABLED', 'true');
  });
  afterAll(async () => {
    if (organizationId) await db.organization.deleteMany({ where: { id: organizationId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('creates an unverified account and consumes the verification link only once', async () => {
    const response = await register(
      request({
        email,
        password: 'a-strong-password-123',
        confirmPassword: 'a-strong-password-123',
      }),
    );
    expect(response.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { members: { include: { organization: true } } },
    });
    userId = user.id;
    organizationId = user.members[0].organizationId;
    expect(user.name).toBeNull();
    expect(user.members[0].organization.name).toBe('My portfolio');
    expect(user.members[0].role).toBe('OWNER');
    expect(user.verificationRequired).toBe(true);
    expect(user.emailVerified).toBeNull();
    expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(0);
    const token = tokenFromLastMessage();
    expect((await authEmail(request({ action: 'verify', token }))).status).toBe(200);
    expect((await authEmail(request({ action: 'verify', token }))).status).toBe(400);
    expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified,
    ).not.toBeNull();
  });
  it('resets a password once and revokes existing sessions', async () => {
    expect((await authEmail(request({ action: 'request-reset', email }))).status).toBe(200);
    const token = tokenFromLastMessage();
    const body = {
      action: 'reset',
      token,
      password: 'another-strong-password-456',
      confirmPassword: 'another-strong-password-456',
    };
    expect((await authEmail(request(body))).status).toBe(200);
    expect((await authEmail(request(body))).status).toBe(400);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.sessionVersion).toBe(1);
    expect(await verify(user.passwordHash!, body.password)).toBe(true);
    expect(await db.securityNotice.count({ where: { ownerId: userId, status: 'pending' } })).toBe(
      1,
    );
  });
  it('returns the same response for an unknown account and rejects expired tokens', async () => {
    const before = messages.length;
    expect(
      (await authEmail(request({ action: 'request-reset', email: 'unknown@example.test' }))).status,
    ).toBe(200);
    expect(messages).toHaveLength(before);
    expect((await authEmail(request({ action: 'request-reset', email }))).status).toBe(200);
    const token = tokenFromLastMessage();
    await db.authToken.updateMany({
      where: { userId, kind: 'reset' },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await authEmail(
          request({
            action: 'reset',
            token,
            password: 'another-strong-password-456',
            confirmPassword: 'another-strong-password-456',
          }),
        )
      ).status,
    ).toBe(400);
  });
});
