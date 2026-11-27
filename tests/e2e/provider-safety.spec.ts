import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
const email = `safe-ui-${randomUUID()}@example.test`;
const password = 'BrowserTest!2026secure';
const name = 'provider-safety-ui.test';
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
test('keeps asking prices local and hides registrar writes without a verified connection', async ({
  page,
  verifyFixtureEmail,
}) => {
  const registered = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: {
      name: 'Safety test',
      email,
      password,
      confirmPassword: password,
      workspace: 'Safety workspace',
    },
  });
  expect(registered.status()).toBe(200);
  await verifyFixtureEmail(email, page.request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    include: { ownedWorkspaces: true },
  });
  const domain = await db.domain.create({
    data: {
      organizationId: user.ownedWorkspaces[0].id,
      name,
      unicodeName: name,
      tld: 'test',
      registrations: {
        create: {
          registrar: 'Namecheap',
          nameservers: ['old.example.test'],
          verifiedAt: new Date(),
        },
      },
      listings: { create: { marketplace: 'afternic', binPrice: '100' } },
    },
    include: { registrations: true, listings: true },
  });
  await page.goto('/domains');
  await page.getByRole('button', { name: `Edit asking price for ${name}` }).click();
  const price = page.getByRole('dialog');
  await expect(
    price.getByText('Provider listings are not changed.', { exact: false }),
  ).toBeVisible();
  await price.getByLabel('Asking price (USD)').fill('200');
  await price.getByRole('button', { name: 'Save asking price' }).click();
  await expect(page.getByText(`Asking price updated for ${name}`)).toBeVisible();
  expect(
    (
      await db.domainListing.findUniqueOrThrow({ where: { id: domain.listings[0].id } })
    ).binPrice?.toString(),
  ).toBe('100');
  await page.getByRole('link', { name: new RegExp(name.replace('.', '\\.')) }).click();
  await expect(page.getByRole('heading', { name: 'Nameservers & ownership' })).toBeVisible();
  await expect(page.getByText('old.example.test', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Change nameservers for ${name}`, exact: true }),
  ).toHaveCount(0);
  const registration = await db.domainRegistration.findUniqueOrThrow({
    where: { id: domain.registrations[0].id },
  });
  expect(registration.nameservers).toEqual(['old.example.test']);
  expect(registration.verifiedAt).toEqual(domain.registrations[0].verifiedAt);
  expect(await db.providerChange.count({ where: { organizationId: domain.organizationId } })).toBe(0);
  await page.getByRole('button', { name: 'Marketplace listings' }).click();
  await expect(page.getByRole('button', { name: 'Delisting unavailable' })).toBeDisabled();
});
