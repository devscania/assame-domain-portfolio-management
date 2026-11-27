import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { scheduleRenewalReminders, sendOneRenewalReminder } from '../../src/lib/renewal-reminders';
const email = `renewal-preference-${randomUUID()}@example.test`;
const password = 'BrowserTest!2026secure';
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
test('renewal emails are separately opt-in and persist across reloads', async ({
  page,
  verifyFixtureEmail,
}) => {
  const result = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: {
      name: 'Reminder test',
      email,
      password,
      confirmPassword: password,
      workspace: 'Reminder workspace',
    },
  });
  expect(result.status()).toBe(200);
  await verifyFixtureEmail(email, page.request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  await page.goto('/settings?tab=preferences');
  const renewal = page.getByRole('checkbox', {
    name: 'Email me weekly renewal reminders for workspaces I own',
  });
  await expect(renewal).toBeEnabled();
  await expect(renewal).not.toBeChecked();
  await renewal.check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.reload();
  await expect(renewal).toBeChecked();
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    include: { ownedWorkspaces: true },
  });
  const organizationId = user.ownedWorkspaces[0].id;
  await db.domain.create({
    data: {
      organizationId,
      name: `reminder-${randomUUID()}.test`,
      unicodeName: 'reminder.test',
      tld: 'test',
      registrations: {
        create: {
          registrar: 'Fixture',
          nameservers: [],
          expiresAt: new Date(Date.now() + 5 * 86400000),
        },
      },
    },
  });
  expect(await scheduleRenewalReminders()).toBe(1);
  expect(await sendOneRenewalReminder()).toBe(true);
  expect((await db.renewalReminder.findFirstOrThrow({ where: { organizationId } })).status).toBe(
    'sent',
  );
  await renewal.uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.reload();
  await expect(renewal).not.toBeChecked();
});
