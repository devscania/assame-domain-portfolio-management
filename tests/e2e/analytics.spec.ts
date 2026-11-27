import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
test('analytics displays separate Afternic and Atom counters without inventing unsupported traffic', async ({
  page,
  verifyFixtureEmail,
}) => {
  const email = `analytics-${Date.now()}@example.test`,
    password = 'AnalyticsFixture!2026secure';
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
            name: 'Analytics fixture',
            workspace: 'SYNTHETIC ANALYTICS FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;
    await db.organization.update({ where: { id: orgId }, data: { demo: true } });
    await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'traffic-fixture.test',
        unicodeName: 'traffic-fixture.test',
        tld: 'test',
        source: 'fixture',
        listings: {
          create: [
            {
              marketplace: 'afternic',
              source: 'fixture',
              analytics: { views: 20, leads: 2, observedAt: '2026-11-07T00:00:00Z' },
            },
            {
              marketplace: 'atom',
              source: 'fixture',
              analytics: {
                views: 70,
                shortlists: 4,
                offers: 3,
                observedAt: '2026-11-07T00:00:00Z',
              },
            },
          ],
        },
      },
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
    await page.goto('/analytics');
    const afternic = page.getByRole('article', { name: 'Afternic listing statistics' }),
      atom = page.getByRole('article', { name: 'Atom listing statistics' });
    await expect(afternic.getByText('20', { exact: true })).toBeVisible();
    await expect(atom.getByText('70', { exact: true })).toBeVisible();
    await expect(atom.getByText('Offers', { exact: true })).toBeVisible();
    await expect(atom.getByText('Shortlists', { exact: true })).toBeVisible();
    await expect(atom.getByText('Synthetic', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Combined marketplace daily traffic' }),
    ).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Spaceship listing statistics' }).getByText(/not exposed/),
    ).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Dynadot listing statistics' }).getByText(/not exposed/),
    ).toBeVisible();
    await page.screenshot({ path: '.local/analytics-marketplaces.png', fullPage: true });
  } finally {
    if (orgId) await db.organization.delete({ where: { id: orgId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
