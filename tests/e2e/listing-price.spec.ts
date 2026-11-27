import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
test('workspace publishing opt-in and exact provider price preview/confirmation UI', async ({
  page,
  verifyFixtureEmail,
}) => {
  test.skip(
    process.env.PROVIDER_WRITES_ENABLED !== 'true',
    'Requires the explicitly enabled publishing feature; provider calls remain mocked.',
  );
  const email = `price-ui-${Date.now()}@example.test`;
  const password = 'PriceUiOnly!2026secure';
  let orgId: string | undefined;
  let userId: string | undefined;
  try {
    expect(
      (
        await page.request.post('/api/register', {
          headers: { Origin: browserOrigin, 'x-forwarded-for': email },
          data: {
            email,
            password,
            confirmPassword: password,
            name: 'Price UI fixture',
            workspace: 'PRICE UI FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;
    const account = await db.providerAccount.create({
      data: {
        organizationId: orgId,
        providerId: 'afternic',
        label: 'UNVERIFIED TEST FIXTURE',
        status: 'unverified',
        syncEveryHours: 0,
      },
    });
    const domain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'publish-fixture.test',
        unicodeName: 'publish-fixture.test',
        tld: 'test',
        source: 'fixture',
        listings: {
          create: {
            providerAccountId: account.id,
            marketplace: 'afternic',
            source: 'fixture',
            binPrice: '2499',
            currency: 'USD',
            status: 'ACTIVE',
          },
        },
      },
      include: { listings: true },
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    await page.goto('/settings?tab=publishing');
    await page
      .getByRole('checkbox', { name: 'Allow confirmed provider BIN price changes' })
      .check();
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Save publishing preference' }).click(),
    ]);
    await expect(
      page.getByRole('checkbox', { name: 'Allow confirmed provider BIN price changes' }),
    ).toBeChecked();
    let confirmations = 0;
    let confirmedBatch: string[] = [];
    await page.route('**/api/console*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.action === 'listing.price.preview')
          return route.fulfill({
            json: {
              id: 'fixture-preview',
              domainName: 'publish-fixture.test',
              provider: 'Afternic',
              oldPrice: '2499',
              newPrice: body.data.newPrice,
              currency: 'USD',
            },
          });
        if (body.action === 'listing.price.confirm') {
          confirmations++;
          return route.fulfill({ json: { changeId: 'fixture-preview', jobId: 'fixture-job' } });
        }
        if (body.action === 'listing.price.preview_all') {
          const preview = (id: string, provider: string, oldPrice: string) => ({
            provider,
            reason: null,
            preview: {
              id,
              domainName: 'publish-fixture.test',
              provider,
              oldPrice,
              newPrice: body.data.newPrice,
              currency: 'USD',
            },
          });
          return route.fulfill({
            json: {
              newPrice: body.data.newPrice,
              currency: 'USD',
              previews: [
                preview('batch-aft', 'Afternic', '2499'),
                preview('batch-atom', 'Atom', '2999'),
                {
                  provider: 'SellerHub',
                  preview: null,
                  reason: 'Connect a provider account first.',
                },
              ],
            },
          });
        }
        if (body.action === 'listing.price.confirm_all') {
          confirmedBatch = body.data.previewIds;
          return route.fulfill({
            json: confirmedBatch.map((changeId) => ({ changeId, jobId: `job-${changeId}` })),
          });
        }
      }
      if (url.searchParams.get('view') === 'priceChange')
        return route.fulfill({
          json:
            url.searchParams.get('id') === 'batch-atom'
              ? {
                  status: 'failed',
                  newPrice: '3000',
                  currency: 'USD',
                  error: 'Atom rejected the price.',
                }
              : { status: 'completed', newPrice: '3000', currency: 'USD', error: null },
        });
      await route.continue();
    });
    await page.goto('/domains');
    await page
      .getByRole('button', { name: 'Edit afternic price for publish-fixture.test', exact: true })
      .click();
    await page.getByLabel('New BIN price (USD)').fill('3000');
    await page.getByRole('button', { name: 'Preview provider change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Update marketplace BIN price' });
    await expect(dialog.getByText('$2,499', { exact: true })).toBeVisible();
    await expect(dialog.getByText('$3,000', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.local/price-preview.png', fullPage: true });
    expect(confirmations).toBe(0);
    await page.getByRole('button', { name: 'Confirm & queue price change' }).click();
    await expect(page.getByText('Provider price verified: $3,000', { exact: true })).toBeVisible();
    expect(confirmations).toBe(1);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Edit afternic price for publish-fixture.test', exact: true })
      .click();
    await dialog.getByLabel('New BIN price (USD)').fill('3000');
    await dialog.getByRole('checkbox', { name: /sync all marketplaces/ }).check();
    await dialog.getByRole('button', { name: 'Preview provider change' }).click();
    await expect(dialog.getByText('$2,999', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('Connect a provider account first.', { exact: false }),
    ).toBeVisible();
    expect(confirmedBatch).toEqual([]);
    await dialog.getByRole('button', { name: 'Confirm & queue price change' }).click();
    await expect.poll(() => confirmedBatch).toEqual(['batch-aft', 'batch-atom']);
    await expect(dialog.getByText('Provider price verified: $3,000')).toBeVisible();
    await expect(dialog.getByText('Atom rejected the price.')).toBeVisible();
    await db.syncJob.create({
      data: {
        providerAccountId: account.id,
        kind: 'price',
        status: 'unverified',
        error: 'The provider still reports the previous price.',
        priceChange: {
          create: {
            organizationId: orgId,
            providerAccountId: account.id,
            listingId: domain.listings[0].id,
            requestedBy: userId,
            oldPrice: 2499,
            newPrice: 3000,
            currency: 'USD',
            remoteStatus: 'ACTIVE',
            status: 'unverified',
            expiresAt: new Date(),
          },
        },
      },
    });
    await db.syncJob.create({
      data: { providerAccountId: account.id, kind: 'statistics', status: 'running' },
    });
    await db.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: userId,
        action: 'listing.price_unverified',
        entityId: domain.listings[0].id,
        detail: { previousPrice: '2499', newPrice: '3000', currency: 'USD' },
      },
    });
    await page.goto('/sync#provider-jobs');
    const providerJobs = page.locator('#provider-jobs');
    await expect(providerJobs.getByText('BIN price change')).toBeVisible();
    await expect(providerJobs.getByRole('link', { name: domain.name })).toHaveAttribute(
      'href',
      `/domains/${domain.id}`,
    );
    await expect(providerJobs.getByText('$2,499 → $3,000', { exact: true })).toBeVisible();
    await expect(
      providerJobs.getByText('The provider still reports the previous price.'),
    ).toBeVisible();
    const history = page.locator('#workspace-history');
    await expect(history.getByText('Marketplace price needs verification')).toBeVisible();
    await expect(history.getByRole('link', { name: domain.name })).toBeVisible();
    await providerJobs.getByLabel('Filter provider jobs').selectOption('active');
    await expect(providerJobs.getByText('Listing statistics')).toBeVisible();
    await expect(providerJobs.getByText('BIN price change')).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    await providerJobs.getByLabel('Filter provider jobs').selectOption('review');
    await expect(providerJobs.getByText('Needs verification')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await providerJobs.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('dialog', { name: 'Provider job details' })).toBeVisible();
    await expect(page.getByRole('dialog').getByText(domain.name, { exact: true })).toBeVisible();
    await page.goto('/contact?topic=bug');
    await expect(page.getByLabel('Request type')).toHaveValue('bug');
    await expect(page.getByLabel('What happened?')).toBeVisible();
    await page.getByLabel('Request type').selectOption('feature');
    await expect(page.getByLabel('What would you like to do?')).toBeVisible();
  } finally {
    if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
