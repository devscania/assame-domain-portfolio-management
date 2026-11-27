import { test, expect } from './browser-test';
test('settings categories keep separate forms and preserve deep links', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@assame.local');
  await page.getByLabel(/^Password/).fill('AssameDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  await page.goto('/settings');
  await expect(page.getByLabel('Workspace name', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Settings categories' });
  for (const [tab, label, heading] of [
    ['preferences', 'Preferences', 'Appearance & notifications'],
    ['team', 'Team & roles', 'Team members'],
    ['publishing', 'Provider controls', 'Provider price publishing'],
    ['security', 'Account security', 'Sessions'],
  ]) {
    await nav.getByRole('link', { name: new RegExp(label) }).click();
    await expect(page).toHaveURL(new RegExp('tab=' + tab));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByLabel('Workspace name', { exact: true })).toHaveCount(0);
  }
  await page.goto('/settings?tab=preferences');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goto('/settings?tab=invalid');
  await expect(page.getByLabel('Workspace name', { exact: true })).toBeVisible();
  await page.route('**/api/console', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { error: 'Synthetic save failure.' } })
      : route.continue(),
  );
  await page.getByLabel('Workspace name', { exact: true }).fill('Unsaved fixture value');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect(page.getByText('Synthetic save failure.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue(
    'Unsaved fixture value',
  );
  await page.goto('/settings?tab=security');
  await page.getByText('Remove my account', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Permanently remove account', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Email removal link/ })).toHaveCount(0);
});
