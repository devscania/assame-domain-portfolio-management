import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
import { decrypt } from '../../src/lib/security';

test('Namecheap connection validates IPv4 and stores credentials without exposing them', async ({
  page,
  verifyFixtureEmail,
}) => {
  const email = `namecheap-ui-${Date.now()}@example.test`;
  const password = 'NamecheapUiOnly!2026secure';
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
            name: 'Namecheap UI fixture',
            workspace: 'NAMECHEAP UI FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Connect Namecheap', exact: true }).click();
    await expect(page.getByLabel('API secret', { exact: true })).toHaveCount(0);
    await page.getByLabel('Account label').fill('NAMECHEAP UI FIXTURE');
    await page.getByLabel('API key', { exact: true }).fill('synthetic-namecheap-ui-key');
    await page.getByLabel('Namecheap username', { exact: true }).fill('fixture-user');
    await page.getByLabel('Allowlisted public IPv4', { exact: true }).fill('::1');
    const invalid = page.waitForResponse(
      (r) => r.url().endsWith('/api/console') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save encrypted credentials' }).click();
    expect((await invalid).status()).toBe(400);
    await page.getByLabel('Allowlisted public IPv4', { exact: true }).fill('203.0.113.10');
    expect(await db.providerAccount.count({ where: { organizationId: orgId } })).toBe(0);
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/console') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save encrypted credentials' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(Object.keys(await response.json())).toEqual(['id']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const account = await db.providerAccount.findFirstOrThrow({
      where: { organizationId: orgId, providerId: 'namecheap' },
      include: { credential: true },
    });
    expect(account.status).toBe('unverified');
    expect(account.credential?.ciphertext).not.toContain('synthetic-namecheap-ui-key');
    expect(decrypt(account.credential!.ciphertext)).toMatchObject({
      apiKey: 'synthetic-namecheap-ui-key',
      apiUser: 'fixture-user',
      clientIp: '203.0.113.10',
    });
    const listing = await page.request.get('/api/console?view=summary');
    const summary = await listing.text();
    expect(summary).not.toContain('synthetic-namecheap-ui-key');
    expect(summary).not.toContain('fixture-user');
    // Never test/sync a synthetic key against the real provider.
  } finally {
    if (orgId) await db.organization.delete({ where: { id: orgId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
