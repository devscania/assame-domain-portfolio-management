import { browserOrigin, browserUrl } from './environment';
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';

test('platform administration is limited to explicitly authorized accounts', async ({
  page,
  browser,
  verifyFixtureEmail,
}) => {
  test.skip(
    !process.env.PLATFORM_ADMIN_USER_IDS,
    'Requires an explicitly configured isolated-test administrator',
  );
  const email = `admin-browser-${randomUUID()}@example.test`;
  const password = 'AdminBrowserFixture!2026';
  const contactEmail = `contact-admin-${randomUUID()}@example.test`;
  let userId = '',
    orgId = '';
  const fixtureAdmin = await db.user.findUniqueOrThrow({
    where: { email: 'demo@assame.local' },
    select: { id: true, emailVerified: true },
  });
  await db.user.update({ where: { id: fixtureAdmin.id }, data: { emailVerified: new Date() } });
  const adminContext = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `admin-browser-${randomUUID()}` },
  });
  try {
    await db.contactRequest.create({
      data: {
        name: 'Synthetic admin contact',
        email: contactEmail,
        message: 'Synthetic inquiry for administrator review.',
      },
    });
    const anonymous = await page.request.get('/admin/contacts', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(404);
    expect(await anonymous.text()).not.toContain(contactEmail);
    const registered = await page.request.post('/api/register', {
      headers: { Origin: browserOrigin, 'x-forwarded-for': email },
      data: {
        email,
        password,
        confirmPassword: password,
        name: 'Ordinary workspace owner',
        workspace: 'Admin isolation fixture',
      },
    });
    expect(registered.status()).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { ownedWorkspaces: true },
    });
    userId = user.id;
    orgId = user.ownedWorkspaces[0].id;
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    const denied = await page.request.get('/admin/accounts', { maxRedirects: 0 });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain('Find registered users');
    const adminPage = await adminContext.newPage();
    await adminPage.goto(browserUrl('/login'));
    await adminPage.getByLabel('Email address').fill('demo@assame.local');
    await adminPage.getByLabel('Password', { exact: true }).fill('AssameDemo!2026');
    await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(adminPage.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await adminPage.waitForLoadState('load');
    await adminPage.getByRole('button', { name: 'Account menu', exact: true }).click();
    await adminPage.getByRole('menuitem', { name: 'Platform administration' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    await expect(adminPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const accountsResponse = await adminPage.goto(`${browserOrigin}/admin/accounts/${userId}`);
    expect(accountsResponse?.headers()['cache-control']).toContain('no-store');
    await expect(adminPage.getByText(email)).toBeVisible();
    await adminPage.goto(browserUrl('/admin/contacts'));
    await expect(adminPage.getByText(contactEmail)).toBeVisible();
    const contact = adminPage.locator('article').filter({ hasText: contactEmail });
    await contact.getByLabel('Status for Synthetic admin contact').selectOption('in_progress');
    await contact.getByRole('button', { name: 'Save status' }).click();
    await expect(contact.locator('p').filter({ hasText: 'In progress' })).toBeVisible();
    expect(
      (await db.contactRequest.findFirstOrThrow({ where: { email: contactEmail } })).status,
    ).toBe('in_progress');
    await adminPage.getByLabel('Filter by status').selectOption('in_progress');
    await adminPage.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(adminPage.getByText(contactEmail)).toBeVisible();
    const actor = await db.user.findUniqueOrThrow({ where: { email: 'demo@assame.local' } });
    expect(
      await db.platformAdminAudit.count({
        where: { actorId: actor.id, action: 'account.view', resourceId: userId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await db.platformAdminAudit.count({
        where: { actorId: actor.id, action: 'contact.status.new.in_progress' },
      }),
    ).toBeGreaterThan(0);
  } finally {
    await adminContext.close();
    await db.user.update({
      where: { id: fixtureAdmin.id },
      data: { emailVerified: fixtureAdmin.emailVerified },
    });
    await db.contactRequest.deleteMany({ where: { email: contactEmail } });
    if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
