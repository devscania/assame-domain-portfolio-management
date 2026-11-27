import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
import { encrypt } from '../../src/lib/security';

test('500-row pages, acquisition-cost batch preview, renewal filters and marketplace comparisons', async ({
  page,
  verifyFixtureEmail,
}) => {
  const email = `controls-${Date.now()}@example.test`,
    password = 'ControlsFixture!2026secure';
  let orgId: string | undefined, userId: string | undefined;
  try {
    expect(
      (
        await page.request.post('/api/register', {
          headers: { Origin: browserOrigin, 'x-forwarded-for': email },
          data: {
            email,
            password,
            confirmPassword: password,
            name: 'Controls fixture',
            workspace: 'CONTROLS FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;

    await db.domain.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        organizationId: orgId!,
        name: `enhanced-${String(i).padStart(3, '0')}.test`,
        unicodeName: `enhanced-${String(i).padStart(3, '0')}.test`,
        tld: 'test',
        askingPrice: '9999',
        source: 'fixture',
      })),
    });
    const domains = await db.domain.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
    await db.domainRegistration.createMany({
      data: domains.map((d, i) => ({
        domainId: d.id,
        registrar: i % 2 ? 'Spaceship' : 'Namecheap',
        expiresAt: new Date(Date.now() + (i < 10 ? -1 : 7) * 86400000),
        source: 'fixture',
      })),
    });
    for (let i = 0; i < 3; i++)
      await db.domainListing.createMany({
        data: [
          {
            domainId: domains[i].id,
            marketplace: 'afternic',
            binPrice: '100',
            status: 'ACTIVE',
            source: 'fixture',
          },
          {
            domainId: domains[i].id,
            marketplace: 'atom',
            binPrice: i === 0 ? '200' : i === 1 ? '100' : null,
            status: 'Seller Approved',
            source: 'fixture',
          },
        ],
      });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    await page.goto('/domains');
    await page.getByRole('combobox', { name: 'Domains per page' }).selectOption('500');
    await expect(page.getByRole('link', { name: /enhanced-\d+\.test/ })).toHaveCount(500);
    await page.getByRole('checkbox', { name: 'Select all domains on this page' }).check();
    await page.getByRole('button', { name: 'Batch edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Acquisition cost', exact: true }).click();
    await page.getByLabel('New acquisition cost', { exact: true }).fill('12.34');
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
    const confirmed = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/console') && r.request().postDataJSON()?.action === 'bulk.confirm',
    );
    await page
      .getByRole('button', { name: 'Confirm 500 acquisition cost changes', exact: true })
      .click();
    expect((await confirmed).status()).toBe(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await db.domain.count({
        where: { organizationId: orgId, acquisitionCost: '12.34', askingPrice: '9999' },
      }),
    ).toBe(500);
    expect(
      await db.auditLog.count({
        where: { organizationId: orgId, action: 'domain.acquisition_cost_updated' },
      }),
    ).toBe(500);
    const requestHeaders = { Origin: browserOrigin };
    const preview = await (
      await page.request.post('/api/console', {
        headers: requestHeaders,
        data: {
          action: 'bulk.preview',
          data: { ids: [domains[0].id], field: 'acquisitionCost', price: '20' },
        },
      })
    ).json();
    await db.domain.update({ where: { id: domains[0].id }, data: { acquisitionCost: '13' } });
    expect(
      (
        await page.request.post('/api/console', {
          headers: requestHeaders,
          data: { action: 'bulk.confirm', data: { token: preview.token } },
        })
      ).status(),
    ).toBe(409);
    await db.domain.update({ where: { id: domains[499].id }, data: { askingPrice: null } });
    await page.goto('/domains?q=enhanced-499.test');
    const unsetPrice = page.getByRole('button', {
      name: 'Edit asking price for enhanced-499.test',
    });
    await unsetPrice.getByText('Set asking price', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio asking price' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto('/renewals');
    const pastDue = page.getByRole('link', { name: /past-due registration records/i });
    const review = page.locator('#renewal-review');
    await pastDue.click();
    await expect(review).toBeFocused();
    await expect(page).toHaveURL(/expiration=expired.*#renewal-review$/);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const historyLength = await page.evaluate(() => history.length);
    await pastDue.click();
    await expect(review).toBeInViewport();
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.goto('/renewals');
    await expect(page.getByRole('combobox', { name: 'Expiration window' })).toHaveCount(0);
    const expirationSort = page.waitForResponse(
      (r) =>
        r.url().includes('/api/console?') &&
        r.url().includes('sort=expiration') &&
        r.url().includes('direction=desc'),
    );
    await page.getByRole('button', { name: 'Expiration', exact: true }).click();
    expect(
      (await (await expirationSort).json()).rows[0].registrations[0].expiresAt >
        new Date().toISOString(),
    ).toBe(true);
    await page.getByRole('combobox', { name: 'Filter registrar' }).selectOption('Namecheap');
    await page.getByRole('combobox', { name: 'Domains per page' }).selectOption('500');
    await expect(page.getByRole('link', { name: /enhanced-\d+\.test/ })).toHaveCount(250);
    await page
      .getByRole('button', { name: 'Edit renewal cost for enhanced-000.test', exact: true })
      .click();
    await page.getByLabel('Annual renewal cost (USD)', { exact: true }).fill('15.55');
    await page.getByRole('button', { name: 'Save renewal estimate', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      (
        await db.domainRegistration.findFirstOrThrow({
          where: { domainId: domains[0].id, registrar: 'Namecheap' },
        })
      ).renewalCost?.toString(),
    ).toBe('15.55');
    const exported = await page.request.get('/api/export?expiration=expired&registrar=Namecheap');
    expect((await exported.text()).trim().split('\r\n')).toHaveLength(6);
    await page.goto('/listings');
    await page.getByRole('combobox', { name: 'Filter price comparison' }).selectOption('mismatch');
    await expect(page.getByRole('link', { name: /enhanced-\d+\.test/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Price comparison', exact: true }).click();
    await page.getByRole('combobox', { name: 'Filter price comparison' }).selectOption('unpriced');
    await expect(page.getByText('No BIN returned', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Filter price comparison' })
      .selectOption('insufficient');
    await page.getByRole('combobox', { name: 'Domains per page' }).selectOption('500');
    await expect(page.getByRole('link', { name: /enhanced-\d+\.test/ })).toHaveCount(497);
    await page.screenshot({ path: '.local/marketplace-controls.png', fullPage: false });
  } finally {
    if (orgId) await db.organization.delete({ where: { id: orgId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});

test('listing creation requires exact preview and explicit confirmation in the browser', async ({
  page,
  verifyFixtureEmail,
}) => {
  test.skip(process.env.PROVIDER_WRITES_ENABLED !== 'true', 'Deployment write gate is off');
  const email = `listing-ui-${Date.now()}@example.test`,
    password = 'ListingUiFixture!2026secure';
  let orgId: string | undefined, userId: string | undefined;
  try {
    expect(
      (
        await page.request.post('/api/register', {
          headers: { Origin: browserOrigin, 'x-forwarded-for': email },
          data: {
            email,
            password,
            confirmPassword: password,
            name: 'Listing action fixture',
            workspace: 'LISTING ACTION FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;
    await db.organization.update({ where: { id: orgId }, data: { providerActionsEnabled: true } });
    await db.providerAccount.create({
      data: {
        organizationId: orgId,
        providerId: 'spaceship',
        label: 'UNVERIFIED UI FIXTURE',
        syncEveryHours: 0,
        credential: {
          create: {
            ciphertext: encrypt({ apiKey: 'fixture-only-key', apiSecret: 'fixture-only-secret' }),
          },
        },
      },
    });
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'listing-ui-fixture.test',
        unicodeName: 'listing-ui-fixture.test',
        tld: 'test',
        source: 'fixture',
        listings: {
          create: {
            marketplace: 'atom',
            binPrice: '100',
            status: 'Seller Approved',
            source: 'fixture',
          },
        },
      },
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    let confirmed = 0;
    await page.route('**/api/console', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.action === 'provider.change.preview')
        return route.fulfill({
          json: {
            id: 'fixture-preview',
            domainName: 'listing-ui-fixture.test',
            provider: 'Spaceship',
            input: { action: 'addListing', price: '2500.00', currency: 'USD' },
            existingRecords: 0,
          },
        });
      if (body?.action === 'provider.change.confirm') {
        confirmed++;
        return route.fulfill({ json: { changeId: 'fixture-change', jobId: 'fixture-job' } });
      }
      if (body?.action === 'listing.statistics.queue')
        return route.fulfill({ json: { jobs: ['fixture-statistics'] } });
      return route.continue();
    });
    await page.route('**/api/console?view=providerChange*', (route) =>
      route.fulfill({ json: { status: 'completed', action: 'addListing', error: null } }),
    );
    await page.route('**/api/console?view=jobStatus*', async (route) => {
      await db.domainListing.updateMany({
        where: { domain: { organizationId: orgId }, marketplace: 'atom' },
        data: {
          analytics: { views: 125, offers: 2, shortlists: 4, observedAt: new Date().toISOString() },
        },
      });
      return route.fulfill({
        json: [{ id: 'fixture-statistics', status: 'completed', updated: 1, error: null }],
      });
    });
    await page.goto('/listings');
    await page
      .getByRole('button', {
        name: 'Add Spaceship listing for listing-ui-fixture.test',
        exact: true,
      })
      .click();
    await page.getByLabel('New listing BIN (USD)', { exact: true }).fill('2500');
    await page.getByRole('button', { name: 'Preview exact change', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('New BIN: $2,500', { exact: true })).toBeVisible();
    expect(confirmed).toBe(0);
    await dialog.getByRole('button', { name: 'Confirm add listing', exact: true }).click();
    await expect(dialog.getByText('completed', { exact: true })).toBeVisible();
    expect(confirmed).toBe(1);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select all domains on this page' }).check();
    await page.getByRole('button', { name: 'Fetch marketplace statistics', exact: true }).click();
    await expect(
      page.getByText('125 views · 2 offers · 4 shortlists', { exact: true }),
    ).toBeVisible();
    // Only mocked UI requests were confirmed; no real job/provider write exists.
    expect(await db.providerChange.count({ where: { organizationId: orgId } })).toBe(0);
  } finally {
    if (orgId) await db.organization.delete({ where: { id: orgId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
