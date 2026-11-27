import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
import { randomUUID } from 'node:crypto';
const unique = randomUUID();
const sender = `transfer-sender-${unique}@example.test`;
const receiver = `transfer-receiver-${unique}@example.test`;
const password = 'BrowserTest!2026secure';
const workspace = `Transfer ${unique}`;
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const users = await db.user.findMany({
    where: { email: { in: [sender, receiver] } },
    select: { id: true },
  });
  await db.organization.deleteMany({
    where: { workspaceOwnerId: { in: users.map((user) => user.id) } },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
});
test('two accounts authorize a workspace transfer', async ({
  page,
  browser,
  verifyFixtureEmail,
}) => {
  const other = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `transfer-${unique}` },
  });
  for (const [request, email, name] of [
    [page.request, sender, workspace],
    [other.request, receiver, `Receiver ${unique}`],
  ] as const) {
    const result = await request.post('/api/register', {
      headers: { Origin: browserOrigin, 'x-forwarded-for': email },
      data: { name: 'Transfer test', email, password, confirmPassword: password, workspace: name },
    });
    expect(result.status()).toBe(200);
    await verifyFixtureEmail(email, request);
  }
  await page.goto('/login');
  await page.getByLabel('Email address').fill(sender);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  const response = await page.request.post('/api/console', {
    headers: { Origin: browserOrigin },
    data: { action: 'team.save', data: { email: receiver, role: 'VIEWER' } },
  });
  expect(response.status()).toBe(200);
  await page.goto('/account/workspaces');
  await page.getByLabel('Member email').fill(receiver);
  await page.getByLabel(`Type ${workspace} to confirm`).fill(workspace);
  await page.getByRole('button', { name: 'Request transfer' }).click();
  await expect(page.getByText(`Awaiting ${receiver}`, { exact: false })).toBeVisible();
  const second = await other.newPage();
  await second.goto('/login');
  await second.getByLabel('Email address').fill(receiver);
  await second.getByLabel(/^Password/).fill(password);
  await second.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await second.waitForLoadState('load');
  await second.goto('/account/workspaces');
  await expect(
    second.getByRole('heading', { name: `Ownership request: ${workspace}` }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Accept ownership' }).click();
  await expect(
    second.getByRole('heading', { name: `Ownership request: ${workspace}` }),
  ).toHaveCount(0);
  const transferred = await db.organization.findFirstOrThrow({
    where: { name: workspace },
    include: { workspaceOwner: true },
  });
  expect(transferred.workspaceOwner?.email).toBe(receiver);
  await other.close();
});
