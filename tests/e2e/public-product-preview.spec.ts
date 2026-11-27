import { test, expect } from './browser-test';

test('public overview preview uses the real charts without account portfolio requests', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const portfolioRequests: string[] = [];
  await page.route('**/api/console**', async (route) => {
    portfolioRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto('/');
  const preview = page.locator('.home-dashboard-preview');
  await expect(
    preview.getByRole('heading', { name: 'Portfolio overview', exact: true }),
  ).toBeVisible();
  await expect(preview.locator('.home-dashboard-kpis > div')).toHaveCount(4);
  await expect(preview.locator('.home-dashboard-kpis > div').first()).toContainText('728');
  const profitKpi = preview.locator('.home-dashboard-kpis > div').filter({
    hasText: 'Net portfolio profit',
  });
  await expect(profitKpi).toContainText('$30,120.48');
  await expect(profitKpi).toContainText('$70,600 collected');
  await expect(preview.locator('.financial-chart-net > strong')).toHaveText('$18,772.32');
  await expect(
    preview.getByRole('heading', { name: 'Portfolio performance', exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole('heading', { name: 'A world of extensions', exact: true }),
  ).toBeVisible();
  await expect(preview.locator('.recharts-surface')).toHaveCount(2);
  await expect(preview.locator('figcaption')).toContainText('illustrative records');
  expect(await preview.innerText()).not.toMatch(/demo/i);
  const allTimeKpis = await preview
    .locator('.home-dashboard-kpis > div > strong')
    .allTextContents();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const distribution = preview.locator('.home-dashboard-distribution');
    const leadingGroup = distribution.locator('.distribution-legend > div').first();
    const label = await leadingGroup.locator('strong').innerText();
    const count = await leadingGroup.locator('b').innerText();
    const share = await leadingGroup.locator('small').innerText();
    await distribution.locator('.recharts-pie-sector path').first().dispatchEvent('mouseover');
    const tooltip = distribution.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(`${label} : ${count} (${share})`);
    const plotShapes = new Set<string>();
    for (const [period, amount, change, comparison, start] of [
      ['7d', '$6,081.26', '+105.4%', 'vs previous 7 days', '2026-11-03'],
      ['14d', '$9,042.32', '+206.5%', 'vs previous 14 days', '2026-10-27'],
      ['30d', '$11,867.32', '+93.4%', 'vs previous 30 days', '2026-10-11'],
      ['90d', '$15,418.32', '+359.7%', 'vs previous 90 days', '2026-08-12'],
      ['180d', '$18,772.32', '+65.4%', 'vs previous 180 days', '2026-05-14'],
      ['365d', '$30,120.48', 'No prior activity', 'vs previous 365 days', '2025-11-10'],
      ['ytd', '$30,120.48', 'No prior activity', 'vs previous year to date', '2026-01-01'],
      ['all', '$30,120.48', 'No comparison period', 'All recorded activity', '2026-04-02'],
    ] as const) {
      await page
        .getByRole('combobox', { name: 'Portfolio performance period' })
        .selectOption(period);
      const trend = preview.locator('.financial-chart-net');
      await expect(trend.locator(':scope > strong')).toHaveText(amount);
      await expect(trend.locator('.financial-trend-indicator')).toContainText(change);
      await expect(trend).toContainText(comparison);
      if (['365d', 'ytd', 'all'].includes(period))
        await expect(trend.locator('.financial-trend-indicator')).not.toContainText('%');
      expect(
        await trend
          .locator('.financial-trend-indicator')
          .evaluate(
            (node) =>
              getComputedStyle(node.querySelector('svg')!).color === getComputedStyle(node).color,
          ),
      ).toBe(true);
      expect(
        await preview.locator('.home-dashboard-kpis > div > strong').allTextContents(),
      ).toEqual(allTimeKpis);
      await expect(preview.locator('.financial-chart-range')).toContainText(start);
      plotShapes.add(
        (await preview
          .locator('.home-dashboard-performance path.recharts-area-curve')
          .first()
          .getAttribute('d')) ?? '',
      );
      expect(await trend.evaluate((node) => node.scrollWidth > node.clientWidth + 1)).toBe(false);
    }
    expect(plotShapes.size).toBeGreaterThanOrEqual(4);
    const plot = preview.locator('.home-dashboard-performance .recharts-wrapper');
    await plot.scrollIntoViewIfNeeded();
    const bounds = await plot.boundingBox();
    await plot.hover({ position: { x: bounds!.width * 0.6, y: bounds!.height * 0.4 } });
    await expect(
      preview.locator('.home-dashboard-performance .recharts-tooltip-wrapper'),
    ).toHaveCSS('visibility', 'visible');
    await expect(
      preview.locator('.home-dashboard-performance .recharts-tooltip-wrapper'),
    ).toContainText('Recorded spending');
  }
  await expect(preview.locator('.home-dashboard-kpis select')).toHaveCount(0);
  await expect(preview.locator('.home-dashboard-performance select')).toHaveCount(1);
  const sampleAnimation = (target: typeof page) =>
    target.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const paths = new Set<string>();
          let count = 0;
          function sample() {
            paths.add(
              document
                .querySelector('.home-dashboard-performance path.recharts-area-curve')
                ?.getAttribute('d') ?? '',
            );
            if (++count >= 24) resolve(paths.size);
            else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        }),
    );
  await page.getByRole('combobox', { name: 'Portfolio performance period' }).selectOption('14d');
  expect(await sampleAnimation(page)).toBe(1);
  // Motion's installed hook captures the initial preference, so ordinary motion needs a fresh context.
  const ordinary = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });
  try {
    const origin = new URL(page.url()).origin;
    await ordinary.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await ordinary.route('**/api/console**', async (route) => {
      portfolioRequests.push(route.request().url());
      await route.abort();
    });
    const motionPage = await ordinary.newPage();
    await motionPage.goto(page.url());
    await motionPage
      .locator('.home-dashboard-performance path.recharts-area-curve')
      .first()
      .waitFor();
    await motionPage
      .getByRole('combobox', { name: 'Portfolio performance period' })
      .selectOption('7d');
    // Settle the shared 450ms transition before measuring a distinct period update.
    await motionPage.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let count = 0;
          function settle() {
            if (++count >= 35) resolve();
            else requestAnimationFrame(settle);
          }
          requestAnimationFrame(settle);
        }),
    );
    await motionPage
      .getByRole('combobox', { name: 'Portfolio performance period' })
      .selectOption('30d');
    expect(await sampleAnimation(motionPage)).toBeGreaterThan(1);
  } finally {
    await ordinary.close();
  }
  expect(portfolioRequests).toEqual([]);
  expect(
    await preview
      .locator('.home-dashboard-kpis > div')
      .evaluateAll((cards) => cards.some((card) => card.scrollWidth > card.clientWidth + 1)),
  ).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
