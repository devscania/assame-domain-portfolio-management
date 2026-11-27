import { chooseTheme } from './theme-controls';
import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
const unique = Date.now().toString();
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const users = await db.user.findMany({
    where: { email: { in: [`qa-${unique}@example.test`, `isolation-${unique}@example.test`] } },
    select: { id: true },
  });
  await db.organization.deleteMany({
    where: { workspaceOwnerId: { in: users.map((user) => user.id) } },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
});
test('register, import 60 domains, edit, tag, finance, isolation and export', async ({
  page,
  browser,
  verifyFixtureEmail,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name').fill('Browser Test');
  await page.getByLabel('Workspace name').fill(`QA ${unique}`);
  await page.getByLabel('Email address').fill(`qa-${unique}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('BrowserTest!2026secure');
  await page.getByLabel('Confirm password').fill('BrowserTest!2026secure');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Check your email for a verification link.')).toBeVisible();
  await verifyFixtureEmail(`qa-${unique}@example.test`, page.request);
  await page.getByLabel('Email address').fill(`qa-${unique}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('BrowserTest!2026secure');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Connect Atom', exact: true }).click();
  await expect(page.getByLabel('Seller API token')).toBeVisible();
  await expect(page.getByLabel('Atom seller user ID')).toBeVisible();
  await expect(page.getByLabel('API secret', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Create a second workspace before importing the sample portfolio.
  await page.getByRole('button', { name: `Q QA ${unique}` }).click();
  await page.getByRole('menuitem', { name: 'Create workspace' }).click();
  await page.getByLabel('Workspace name').fill(`QA imports ${unique}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.getByRole('button', { name: 'Create workspace', exact: true }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.locator('input[type=file]').setInputFiles('public/sample-domains.csv');
  await expect(page.getByLabel('Domain name *', { exact: true })).toHaveValue('domain');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('60', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirm 60 valid rows' }).click();
  await expect(page.getByText('60 domains added', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'View portfolio' }).click();
  await page.goto('/domains');
  await page
    .getByRole('textbox', { name: 'Search domains', exact: true })
    .fill('sample-domain-001');
  const domainLink = page.getByRole('link', { name: /sample-domain-001.test/ });
  await expect(domainLink).toHaveAttribute('href', /^\/domains\//);
  await page.goto((await domainLink.getAttribute('href'))!);
  await expect(page.getByRole('heading', { name: 'sample-domain-001.test' })).toBeVisible();
  const domainId = page.url().split('/').at(-1)!;
  await page.getByRole('button', { name: 'Edit domain', exact: true }).click();
  await page.getByLabel('Internal asking price', { exact: true }).fill('4500');
  await page.getByLabel('Tags', { exact: false }).fill('Quality; Long-term');
  await page.getByRole('button', { name: 'Save domain' }).click();
  await expect(page.getByText('Quality', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notes & history' }).click();
  await page.getByRole('textbox', { name: 'Domain note' }).fill('Browser verified persisted note.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Browser verified persisted note.')).toBeVisible();
  const rows = await (await page.request.get('/api/console?view=domains&take=2')).json();
  const pricePreview = await (
    await page.request.post('/api/console', {
      headers: { Origin: browserOrigin },
      data: {
        action: 'bulk.preview',
        data: { ids: rows.rows.map((row: { id: string }) => row.id), askingPrice: '4999' },
      },
    })
  ).json();
  expect(pricePreview.rows).toHaveLength(2);
  const published = await page.request.post('/api/console', {
    headers: { Origin: browserOrigin },
    data: { action: 'bulk.confirm', data: { token: pricePreview.token } },
  });
  expect(published.status()).toBe(200);
  const stalePreview = await page.request.post('/api/console', {
    headers: { Origin: browserOrigin },
    data: { action: 'bulk.confirm', data: { token: pricePreview.token } },
  });
  expect(stalePreview.status()).toBe(409);
  await page.reload();
  await page.getByRole('button', { name: 'Notes & history' }).click();
  await expect(page.getByText('Browser verified persisted note.')).toBeVisible();
  // Forged origins and anonymous requests must not read or mutate tenant data.
  const denied = await page.request.post('/api/console', {
    headers: { Origin: 'https://evil.test' },
    data: { action: 'domain.save', data: {} },
  });
  expect(denied.status()).toBe(403);
  const other = await browser.newContext();
  const anonymous = await other.request.get(`/api/console?view=domain&id=${domainId}`);
  expect(anonymous.status()).toBe(401);
  await other.close();
  // A manual LTO sale starts with zero collected revenue.
  await page.goto('/sales');
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await page.getByLabel('Find domain').fill('sample-domain-001');
  await page
    .getByRole('combobox', { name: 'Domain', exact: true })
    .selectOption({ label: 'sample-domain-001.test (USD)' });
  await page.getByLabel('Gross agreement amount').fill('1545');
  await page.getByLabel('Total commission').fill('154.50');
  await page.getByLabel('Installments (1 = outright)').fill('17');
  await page.getByLabel('Marketplace', { exact: true }).fill('Private');
  await page.getByRole('button', { name: 'Record agreement' }).click();
  await expect(page.getByText('17 installments', { exact: true })).toBeVisible();
  const summary = await (await page.request.get('/api/console?view=summary')).json();
  expect(summary.collected).toBe('0');
  expect(summary.gross).toBe('1545.00');
  await page.getByRole('button', { name: 'Payment', exact: true }).click();
  await page.getByLabel('Amount received (USD)').fill('90.89');
  await page.getByLabel('Payment reference', { exact: false }).fill('e2e-first-payment');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByText('$90.89').first()).toBeVisible();
  const paid = await (await page.request.get('/api/console?view=summary')).json();
  expect(paid.collected).toBe('90.89');
  const exported = await page.request.get('/api/export');
  expect(exported.status()).toBe(200);
  expect((await exported.text()).split('\r\n').filter(Boolean)).toHaveLength(61);
  await page.goto('/overview');
  await expect(
    page.getByRole('heading', { name: 'Portfolio performance', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.local/overview-real.png', fullPage: true });
  const second = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `isolation-${unique}` },
  });
  const secondEmail = `isolation-${unique}@example.test`;
  expect(
    (
      await second.request.post('/api/register', {
        headers: { Origin: browserOrigin, 'x-forwarded-for': secondEmail },
        data: {
          name: 'Isolation Test',
          email: secondEmail,
          password: 'SecondTest!2026secure',
          confirmPassword: 'SecondTest!2026secure',
          workspace: `QA second ${unique}`,
        },
      })
    ).status(),
  ).toBe(200);
  await verifyFixtureEmail(secondEmail, second.request);
  const secondPage = await second.newPage();
  await secondPage.goto('/login');
  await secondPage.getByLabel('Email address').fill(secondEmail);
  await secondPage.getByLabel(/^Password/).fill('SecondTest!2026secure');
  await secondPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(secondPage.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await secondPage.waitForLoadState('load');
  expect((await second.request.get(`/api/console?view=domain&id=${domainId}`)).status()).toBe(404);
  expect(
    (
      await page.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: { action: 'team.save', data: { email: secondEmail, role: 'VIEWER' } },
      })
    ).status(),
  ).toBe(200);
  const workspaceId = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'workspace',
  )!.value;
  expect(
    (
      await second.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: { action: 'workspace.switch', data: { id: workspaceId } },
      })
    ).status(),
  ).toBe(200);
  expect((await second.request.get(`/api/console?view=domain&id=${domainId}`)).status()).toBe(200);
  expect(
    (
      await second.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: { action: 'note.create', data: { domainId, body: 'Forbidden viewer edit' } },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await second.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: {
          action: 'account.delete',
          data: { currentPassword: 'SecondTest!2026secure', confirmation: 'DELETE ACCOUNT' },
        },
      })
    ).status(),
  ).toBe(200);
  await second.close();
  // Exercise the user-facing password change and wait for its sign-out navigation.
  // An API-only change invalidates the still-mounted console, whose in-flight
  // server navigation can otherwise interrupt the following sign-in's CSRF request.
  await page.goto('/account/security');
  await page.getByLabel('Current password', { exact: true }).fill('BrowserTest!2026secure');
  await page.getByLabel('New password', { exact: true }).fill('ChangedPassword!2026secure');
  await page.getByLabel('Confirm new password', { exact: true }).fill('ChangedPassword!2026secure');
  const passwordChanged = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/account/password') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  expect((await passwordChanged).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForLoadState('load');
  expect((await page.request.get('/api/console?view=summary')).status()).toBe(401);
  await page.getByLabel('Email address').fill(`qa-${unique}@example.test`);
  await page.getByLabel(/^Password/).fill('ChangedPassword!2026secure');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  expect(
    (
      await page.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: {
          action: 'account.delete',
          data: { currentPassword: 'ChangedPassword!2026secure', confirmation: 'DELETE ACCOUNT' },
        },
      })
    ).status(),
  ).toBe(200);
});
test('demo overview, all screens, dark theme and mobile navigation', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@assame.local');
  await page.getByLabel(/^Password/).fill('AssameDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  await expect(page.getByText('DEMO WORKSPACE', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Portfolio performance', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.local/overview-demo.png', fullPage: true });
  for (const [path, heading] of [
    ['/domains', 'My domains'],
    ['/listings', 'Marketplace listings'],
    ['/registrars', 'Your registrars'],
    ['/sales', 'Sales & revenue'],
    ['/renewals', 'Stay ahead of renewals'],
    ['/analytics', 'Portfolio insights'],
    ['/sync', 'Activity center'],
    ['/connections', 'Connect your portfolio'],
    ['/settings', 'Settings'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText('Your workspace needs attention')).toHaveCount(0);
  }
  await chooseTheme(page, 'light');
  await expect(page.locator('html')).toHaveClass(/light/);
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/overview');
  await expect(
    page.getByRole('heading', { name: 'Portfolio performance', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.local/overview-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'My Domains', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My domains', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/domains-mobile.png', fullPage: true });
});
