import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const mail = vi.hoisted(() => ({
  messages: [] as { to: string; text: string; html: string }[],
  fail: false,
}));
vi.mock('nodemailer-modern', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { to: string; text: string; html: string }) => {
        if (mail.fail) throw new Error('provider failed');
        mail.messages.push(message);
      },
    }),
  },
}));
import { scheduleRenewalReminders, sendOneRenewalReminder } from '../src/lib/renewal-reminders';

describe.skipIf(!process.env.TEST_DATABASE_URL)('workspace renewal reminders', () => {
  let owner = '',
    member = '',
    org = '',
    domain = '',
    email = '';
  const now = new Date('2026-11-10T12:00:00.000Z');
  beforeAll(() => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', 'http://localhost:3010');
    vi.stubEnv('SMTP_HOST', 'mail.example.test');
    vi.stubEnv('SMTP_FROM', 'Assame <test@example.test>');
    vi.stubEnv('RENEWAL_REMINDERS_ENABLED', 'true');
  });
  beforeEach(async () => {
    mail.messages.length = 0;
    mail.fail = false;
    const suffix = randomUUID();
    email = `renewal-owner-${suffix}@example.test`;
    const users = await Promise.all([
      db.user.create({
        data: { email, emailVerified: new Date(), preference: { create: { renewalEmails: true } } },
      }),
      db.user.create({
        data: {
          email: `renewal-viewer-${suffix}@example.test`,
          emailVerified: new Date(),
          preference: { create: { renewalEmails: true } },
        },
      }),
    ]);
    [owner, member] = users.map((user) => user.id);
    const workspace = await db.organization.create({
      data: {
        name: 'Portfolio <safe>',
        workspaceOwnerId: owner,
        members: {
          create: [
            { userId: owner, role: 'OWNER' },
            { userId: member, role: 'VIEWER' },
          ],
        },
      },
    });
    org = workspace.id;
    const record = await db.domain.create({
      data: {
        organizationId: org,
        name: `private-${suffix}.test`,
        unicodeName: `private-${suffix}.test`,
        tld: 'test',
        registrations: {
          create: {
            registrar: 'Example',
            nameservers: [],
            expiresAt: new Date('2026-11-20T00:00:00Z'),
          },
        },
      },
    });
    domain = record.id;
  });
  afterEach(async () => {
    await db.organization.deleteMany({ where: { id: org } });
    await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  });
  it('deduplicates concurrent scheduling and delivers only to the verified owner', async () => {
    const results = await Promise.all([
      scheduleRenewalReminders(now),
      scheduleRenewalReminders(now),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    const sends = await Promise.all([sendOneRenewalReminder(now), sendOneRenewalReminder(now)]);
    expect(sends.filter(Boolean)).toHaveLength(1);
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0].to).toBe(email);
    expect(mail.messages[0].text).toContain('workspace you own');
    expect(mail.messages[0].html).not.toContain('Portfolio');
    expect(mail.messages[0].text).not.toContain('private-');
    expect(
      await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } }),
    ).toMatchObject({ ownerId: owner, status: 'sent' });
    expect(await scheduleRenewalReminders(now)).toBe(0);
  });
  it('does not queue without opt-in, verification, an active domain or an owner membership', async () => {
    await db.userPreference.update({ where: { userId: owner }, data: { renewalEmails: false } });
    expect(await scheduleRenewalReminders(now)).toBe(0);
    await db.userPreference.update({ where: { userId: owner }, data: { renewalEmails: true } });
    await db.user.update({ where: { id: owner }, data: { emailVerified: null } });
    expect(await scheduleRenewalReminders(now)).toBe(0);
    await db.user.update({ where: { id: owner }, data: { emailVerified: new Date() } });
    await db.domain.update({ where: { id: domain }, data: { status: 'archived' } });
    expect(await scheduleRenewalReminders(now)).toBe(0);
    await db.domain.update({ where: { id: domain }, data: { status: 'active' } });
    await db.domainSale.create({
      data: {
        domainId: domain,
        marketplace: 'fixture',
        grossAmount: 1,
        currency: 'USD',
        status: 'completed',
      },
    });
    expect(await scheduleRenewalReminders(now)).toBe(0);
    await db.domainSale.deleteMany({ where: { domainId: domain } });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org, userId: member } },
      data: { role: 'OWNER' },
    });
    expect(await scheduleRenewalReminders(now)).toBe(0);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org, userId: member } },
      data: { role: 'VIEWER' },
    });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org, userId: owner } },
      data: { role: 'ADMIN' },
    });
    expect(await scheduleRenewalReminders(now)).toBe(0);
  });
  it('rechecks preference and ownership before delivery', async () => {
    expect(await scheduleRenewalReminders(now)).toBe(1);
    await db.userPreference.update({ where: { userId: owner }, data: { renewalEmails: false } });
    expect(await sendOneRenewalReminder(now)).toBe(true);
    expect(mail.messages).toHaveLength(0);
    expect(
      (await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } })).status,
    ).toBe('skipped');
    await db.renewalReminder.deleteMany({ where: { organizationId: org } });
    await db.userPreference.update({ where: { userId: owner }, data: { renewalEmails: true } });
    expect(await scheduleRenewalReminders(now)).toBe(1);
    await db.organization.update({ where: { id: org }, data: { workspaceOwnerId: member } });
    expect(await sendOneRenewalReminder(now)).toBe(true);
    expect(mail.messages).toHaveLength(0);
    expect(
      (await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } })).status,
    ).toBe('skipped');
  });
  it('does not automatically replay failed or old attempts', async () => {
    expect(await scheduleRenewalReminders(now)).toBe(1);
    mail.fail = true;
    expect(await sendOneRenewalReminder(now)).toBe(true);
    expect(await sendOneRenewalReminder(now)).toBe(false);
    expect(
      (await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } })).status,
    ).toBe('failed');
    await db.renewalReminder.deleteMany({ where: { organizationId: org } });
    mail.fail = false;
    expect(await scheduleRenewalReminders(now)).toBe(1);
    expect(await sendOneRenewalReminder(new Date('2026-11-17T12:00:00Z'))).toBe(true);
    expect(
      (await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } })).status,
    ).toBe('skipped');
    expect(mail.messages).toHaveLength(0);
  });
  it('does not queue or deliver to a removed account', async () => {
    expect(await scheduleRenewalReminders(now)).toBe(1);
    await db.user.update({ where: { id: owner }, data: { deletedAt: new Date() } });
    expect(await sendOneRenewalReminder(now)).toBe(true);
    expect(mail.messages).toHaveLength(0);
    expect(
      (await db.renewalReminder.findFirstOrThrow({ where: { organizationId: org } })).status,
    ).toBe('skipped');
    await db.renewalReminder.deleteMany({ where: { organizationId: org } });
    expect(await scheduleRenewalReminders(now)).toBe(0);
  });
});
