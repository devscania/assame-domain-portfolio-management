import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
const suffix = randomUUID();
const email = `workspace-view-${suffix}@example.test`;
const password = 'BrowserTest!2026secure';
const first = `First ${suffix}`;
const second = `Second ${suffix}`;
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
test('view owned portfolios and open a different workspace', async ({
  page,
  verifyFixtureEmail,
}) => {
  const registered = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: { name: 'Workspace test', email, password, confirmPassword: password, workspace: first },
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
  await db.domain.create({
    data: {
      organizationId: user.ownedWorkspaces[0].id,
      name: `portfolio-${suffix}.test`,
      unicodeName: `portfolio-${suffix}.test`,
      tld: 'test',
    },
  });
  const workspace = await db.organization.create({
    data: {
      name: second,
      workspaceOwnerId: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  await page.goto('/account/workspaces');
  const firstCard = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: first, exact: true }) });
  await expect(firstCard.getByText('Active domains: 1')).toBeVisible();
  await expect(firstCard.getByText('Connected integrations: None')).toBeVisible();
  const secondCard = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: second, exact: true }) });
  await secondCard.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  expect((await page.context().cookies()).find((item) => item.name === 'workspace')?.value).toBe(
    workspace.id,
  );
});
