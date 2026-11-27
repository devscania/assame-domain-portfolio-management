import { test, expect } from './browser-test';

test('contact request type waits for hydration and resets consistently after submission', async ({
  page,
}) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/contact?topic=bug', { waitUntil: 'commit' });
    const kind = page.getByRole('combobox', { name: 'Request type', exact: true });
    const send = page.getByRole('button', { name: 'Send request', exact: true });
    await expect(kind).toHaveValue('bug');
    await expect(kind).toBeDisabled();
    await expect(send).toBeDisabled();
    releaseScripts();
    await expect(kind).toBeEnabled();
    await kind.selectOption('feature');
    await expect(page.getByLabel('What would you like to do?', { exact: true })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Contact fixture');
    await page.getByLabel('Email', { exact: true }).fill('contact-fixture@example.test');
    await page
      .getByLabel('What would you like to do?', { exact: true })
      .fill('A synthetic feature request for this browser check.');
    await page.route('**/api/contact', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        kind: 'feature',
        name: 'Contact fixture',
        email: 'contact-fixture@example.test',
      });
      await route.fulfill({ json: { ok: true } });
    });
    await send.click();
    await expect(page.getByRole('status')).toHaveText('Your request has been received.');
    await expect(kind).toHaveValue('bug');
    await expect(page.getByLabel('What happened?', { exact: true })).toHaveValue('');
    await kind.selectOption('contact');
    await expect(page.getByLabel('How can we help?', { exact: true })).toBeVisible();
  } finally {
    releaseScripts();
  }
});
