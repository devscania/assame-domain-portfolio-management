import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const mail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/lib/auth-email', () => ({ emailConfigured: () => true, sendWelcomeEmail: mail }));
import { queueWelcomeNotice, sendOneWelcomeNotice } from '../src/lib/welcome-notices';

describe.skipIf(!process.env.TEST_DATABASE_URL)('welcome notification outbox', () => {
  let userId = '';
  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('WELCOME_EMAILS_ENABLED', 'true');
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@example.test`, emailVerified: new Date() },
      })
    ).id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('queues once and concurrent workers send exactly once', async () => {
    await db.$transaction(async (tx) => {
      await queueWelcomeNotice(tx, userId);
      await queueWelcomeNotice(tx, userId);
    });
    expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(1);
    await Promise.all([sendOneWelcomeNotice(), sendOneWelcomeNotice()]);
    expect(mail).toHaveBeenCalledTimes(1);
    expect((await db.welcomeNotice.findUniqueOrThrow({ where: { ownerId: userId } })).status).toBe(
      'sent',
    );
    expect(await sendOneWelcomeNotice()).toBe(false);
  });
  it('skips an unverified or deleted recipient and does not enqueue while disabled', async () => {
    await db.welcomeNotice.delete({ where: { ownerId: userId } });
    vi.stubEnv('WELCOME_EMAILS_ENABLED', 'false');
    await db.$transaction((tx) => queueWelcomeNotice(tx, userId));
    expect(await db.welcomeNotice.count({ where: { ownerId: userId } })).toBe(0);
    vi.stubEnv('WELCOME_EMAILS_ENABLED', 'true');
    await db.user.update({ where: { id: userId }, data: { emailVerified: null } });
    await db.$transaction((tx) => queueWelcomeNotice(tx, userId));
    await sendOneWelcomeNotice();
    expect((await db.welcomeNotice.findUniqueOrThrow({ where: { ownerId: userId } })).status).toBe(
      'skipped',
    );
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it('does not automatically retry an uncertain SMTP failure', async () => {
    await db.welcomeNotice.delete({ where: { ownerId: userId } });
    await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    await db.$transaction((tx) => queueWelcomeNotice(tx, userId));
    mail.mockRejectedValueOnce(new Error('uncertain SMTP response'));
    await sendOneWelcomeNotice();
    expect((await db.welcomeNotice.findUniqueOrThrow({ where: { ownerId: userId } })).status).toBe('failed');
    expect(await sendOneWelcomeNotice()).toBe(false);
    expect(mail).toHaveBeenCalledTimes(2);
  });
});
