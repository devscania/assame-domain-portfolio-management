import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const session = vi.hoisted(() => ({ id: '' }));
vi.mock('../src/auth', () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
import { GET, PATCH } from '../src/app/api/account/preferences/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('account appearance preferences', () => {
  const ids: string[] = [];
  const origin = 'http://localhost:3000';
  function patch(data: object, requestOrigin = origin) {
    return new Request(`${origin}/api/account/preferences`, {
      method: 'PATCH',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    for (let i = 0; i < 2; i++)
      ids.push(
        (await db.user.create({ data: { email: `theme-${randomUUID()}@example.test` } })).id,
      );
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('requires authentication and a same-origin, valid partial update', async () => {
    session.id = '';
    expect((await GET()).status).toBe(401);
    expect((await PATCH(patch({ theme: 'dark' }))).status).toBe(401);
    session.id = ids[0];
    expect((await PATCH(patch({ theme: 'dark' }, 'https://attacker.example'))).status).toBe(403);
    expect((await PATCH(patch({ theme: 'unknown' }))).status).toBe(400);
    expect((await PATCH(patch({ theme: 'dark', userId: ids[1] }))).status).toBe(400);
  });
  it('saves independently per account without overwriting other preferences', async () => {
    session.id = ids[0];
    expect(await (await GET()).json()).toMatchObject({
      theme: null,
      notifications: true,
      renewalEmails: false,
      renewalEmailsAvailable: false,
    });
    expect((await PATCH(patch({ notifications: false }))).status).toBe(200);
    expect((await PATCH(patch({ theme: 'dark' }))).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({
      theme: 'dark',
      notifications: false,
      renewalEmails: false,
    });
    session.id = ids[1];
    expect(await (await GET()).json()).toMatchObject({
      theme: null,
      notifications: true,
      renewalEmails: false,
    });
    expect((await PATCH(patch({ theme: 'system' }))).status).toBe(200);
    session.id = ids[0];
    expect(await (await GET()).json()).toMatchObject({
      theme: 'dark',
      notifications: false,
      renewalEmails: false,
    });
  });
  it('requires configuration for opt-in and keeps email preferences account-scoped', async () => {
    session.id = ids[0];
    vi.stubEnv('RENEWAL_REMINDERS_ENABLED', 'false');
    expect((await PATCH(patch({ renewalEmails: true }))).status).toBe(409);
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASSWORD', '');
    vi.stubEnv('RENEWAL_REMINDERS_ENABLED', 'true');
    expect((await PATCH(patch({ renewalEmails: true }))).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({
      renewalEmails: true,
      renewalEmailsAvailable: true,
      notifications: false,
    });
    vi.stubEnv('RENEWAL_REMINDERS_ENABLED', 'false');
    expect((await PATCH(patch({ renewalEmails: false }))).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({
      renewalEmails: false,
      renewalEmailsAvailable: false,
    });
    session.id = ids[1];
    expect(await (await GET()).json()).toMatchObject({ renewalEmails: false });
  });
});
