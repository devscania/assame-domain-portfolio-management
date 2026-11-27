import { browserOrigin } from './environment';
import { chooseTheme } from './theme-controls';
import { test, expect } from './browser-test';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';

function contrast(element: Element, backgroundSource: string) {
  const parse = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
  const luminance = (rgb: number[]) =>
    rgb
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const foreground = luminance(parse(getComputedStyle(element).color));
  const style = getComputedStyle(backgroundSource === 'body' ? document.body : element);
  const backgrounds = style.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [style.backgroundColor];
  return Math.min(
    ...backgrounds.map((color) => {
      const background = luminance(parse(color));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }),
  );
}

test('public pages, indexing and mobile navigation', async ({ page, request }) => {
  await page.goto('/features');
  await expect(page).toHaveTitle('Features | Assame');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${browserOrigin}/features`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Features' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await chooseTheme(page, 'dark');
  await page.goto('/features');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/');
  const headlineContrast = await page.locator('.hero-copy h1 em').evaluate(contrast, 'body');
  expect(headlineContrast).toBeGreaterThanOrEqual(4.5);
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Your sources, together.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Afternic' })).toBeVisible();
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`${browserOrigin}/sitemap.xml`);
  expect(robots).toContain('/account/');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`${browserOrigin}/features`);
  expect(sitemap).not.toContain(`${browserOrigin}/account`);
  await page.goto('/connections');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: 'Assame home' })).toBeVisible();
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toBeEnabled();
  const loginButtonContrast = await signIn.evaluate(contrast, 'self');
  expect(loginButtonContrast).toBeGreaterThanOrEqual(4.5);
});

test('contact form saves a portfolio inquiry', async ({ page }) => {
  test.skip(
    !process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL,
    'Requires an isolated test database',
  );
  const email = `public-${randomUUID()}@example.test`;
  try {
    await page.goto('/contact');
    await page.getByLabel('Name', { exact: true }).fill('Portfolio owner');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('How can we help?').fill('I would like to discuss a large portfolio.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Your request has been received.')).toBeVisible();
    expect(await db.contactRequest.findFirst({ where: { email } })).not.toBeNull();
  } finally {
    await db.contactRequest.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
