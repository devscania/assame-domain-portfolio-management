import { test, expect } from './browser-test';

// Model an account whose stored theme remains light while a preference write is in flight.
// No account session or real preference mutation is needed for this client-state regression.
test('changing theme does not reload and reapply stale account preferences', async ({ page }) => {
  let preferenceReads = 0;
  const writes: string[] = [];
  await page.route('**/api/account/preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      writes.push(route.request().postDataJSON().theme);
      // Deliberate save latency exposes a preference refetch overwriting the local selection.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    preferenceReads += 1;
    await route.fulfill({
      status: 200,
      json: {
        theme: 'light',
        notifications: true,
        renewalEmails: false,
        renewalEmailsAvailable: false,
      },
    });
  });
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /^Theme:/ })).toBeEnabled();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveAttribute(
    'data-theme-choice',
    'light',
  );
  const initialPreferenceReads = preferenceReads;
  expect(initialPreferenceReads).toBeGreaterThan(0);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/account/preferences') &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await saved;
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveAttribute(
    'data-theme-choice',
    'dark',
  );
  expect(preferenceReads).toBe(initialPreferenceReads);
  expect(writes).toEqual(['dark']);
});
