import { expect, test } from '@playwright/test';
import { browserUrl } from './environment';

test('native unhydrated authentication forms keep fixture credentials out of URLs', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const email = 'private-form-fixture@example.test';
  const password = 'PrivateFormFixture!2026';
  try {
    for (const path of [
      '/login',
      '/register',
      '/forgot-password',
      '/verify-email',
      '/reset-password?token=synthetic-reset-token',
    ]) {
      await page.goto(browserUrl(path), { waitUntil: 'domcontentloaded' });
      const form = page.locator('form').first();
      await expect(form).toHaveAttribute('method', 'post');
      const buttons = form.getByRole('button');
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
      for (const button of await page
        .getByRole('button', { name: /^Continue with (Google|Discord)$/ })
        .all())
        await expect(button).toBeDisabled();
      const emailField = form.locator('input[name="email"]');
      if (await emailField.count()) await emailField.fill(email);
      for (const field of await form.locator('input[type="password"]').all())
        await field.fill(password);
      // Force the browser's native fallback, independently of disabled controls
      // and React. Interception prevents any real authentication mutation.
      await page.route('**/*', async (route) => {
        if (route.request().method() === 'POST')
          await route.fulfill({ status: 405, body: 'Fixture fallback rejected' });
        else await route.continue();
      });
      const [request] = await Promise.all([
        page.waitForRequest(
          (request) => request.isNavigationRequest() && request.method() === 'POST',
        ),
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        form.evaluate((element: HTMLFormElement) => element.submit()),
      ]);
      expect(request.url()).not.toContain(password);
      expect(decodeURIComponent(request.url())).not.toContain(email);
      expect(new URL(request.url()).searchParams.has('password')).toBe(false);
      if (path === '/login' || path === '/register' || path.startsWith('/reset-password'))
        expect(new URLSearchParams(request.postData() || '').get('password')).toBe(password);
      await page.unroute('**/*');
    }
  } finally {
    await context.close();
  }
});
