import { chooseTheme } from './theme-controls';
import { expect, test } from './browser-test';
import { browserOrigin } from './environment';

test('mobile workspace navigation and readable controls work in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@assame.local');
  await page.getByLabel(/^Password/).fill('AssameDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');

  expect(
    (
      await page.request.patch('/api/account/preferences', {
        headers: { Origin: browserOrigin },
        data: { theme: 'light' },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);

  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  const sidebar = page.locator('#workspace-navigation');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('link', { name: 'My Domains' })).toBeVisible();
  expect(
    await sidebar
      .getByRole('link', { name: 'My Domains' })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(menu).toBeFocused();

  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await menu.click();
  await sidebar.getByRole('link', { name: 'My Domains' }).click();
  await expect(page).toHaveURL(/\/domains/);
  await expect(sidebar).toBeHidden();
  const search = page.getByRole('textbox', { name: /search/i }).first();
  if (await search.isVisible())
    expect(
      await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
});
