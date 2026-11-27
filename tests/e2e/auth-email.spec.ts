import { chooseTheme } from './theme-controls';
import { browserOrigin, browserUrl, browserSmtpPort } from './environment';
import { test, expect } from './browser-test';
import { SMTPServer } from 'smtp-server';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { sendOneSecurityNotice } from '../../src/lib/security-notices';

test('registration verifies email and password recovery revokes the old password', async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_DATABASE_URL ||
      process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL ||
      process.env.SMTP_HOST !== '127.0.0.1' ||
      Number(process.env.SMTP_PORT || 2526) !== browserSmtpPort ||
      process.env.SMTP_REQUIRE_TLS !== 'false',
    'Run with the isolated test database and local SMTP fixture',
  );
  const email = `browser-auth-${randomUUID()}@example.test`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `browser-auth-${randomUUID()}` });
  const messages: string[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
      let body = '';
      stream.on('data', (chunk) => {
        body += chunk.toString();
      });
      stream.on('end', () => {
        messages.push(body);
        callback();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(browserSmtpPort, '127.0.0.1', resolve);
  });
  const getToken = () => {
    const body = messages.at(-1)?.replace(/=\r?\n/g, '') || '';
    const token = body.match(/token(?:=3D|=)([A-Za-z0-9_-]{43})/i)?.[1];
    expect(token).toBeTruthy();
    return token!;
  };
  try {
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Browser Auth');
    await page.getByLabel('Workspace name').fill('Browser Auth');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('BrowserTest!2026secure');
    await page.getByLabel('Confirm password').fill('BrowserTest!2026secure');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Check your email for a verification link.')).toBeVisible();
    await expect.poll(() => messages.length).toBe(1);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('IncorrectPassword!2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Unable to sign in. Check your credentials or try again later.'),
    ).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('BrowserTest!2026secure');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Verify your email before signing in.' }),
    ).toBeVisible();
    await page.goto(`/verify-email?token=${getToken()}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByText('Email verified. You can now sign in.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify email' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send email' }).click();
    await expect.poll(() => messages.length).toBe(2);
    await page.goto(`/reset-password?token=${getToken()}`);
    await page.getByLabel('New password').fill('AnotherBrowser!2026secure');
    await page.getByLabel('Confirm password').fill('AnotherBrowser!2026secure');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Your password has been changed. You can now sign in.'),
    ).toBeVisible();
    expect(await sendOneSecurityNotice()).toBe(true);
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('AnotherBrowser!2026secure');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    await page.goto('/connections');
    await expect(page).toHaveURL(/\/connections$/);
    await expect(page.getByRole('heading', { name: 'Connect your portfolio' })).toBeVisible();
    const testUser = await db.user.findUniqueOrThrow({
      where: { email },
      include: { ownedWorkspaces: true },
    });
    const orgId = testUser.ownedWorkspaces[0].id;
    const firstDomain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'limit-one.test',
        unicodeName: 'limit-one.test',
        tld: 'test',
      },
    });
    const secondDomain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'limit-two.test',
        unicodeName: 'limit-two.test',
        tld: 'test',
      },
    });
    // A new account really has 25 slots; arbitrary baseline edits are ignored.
    await db.domain.createMany({
      data: Array.from({ length: 24 }, (_, index) => ({
        organizationId: orgId,
        name: `limit-extra-${index}.test`,
        unicodeName: `limit-extra-${index}.test`,
        tld: 'test',
      })),
    });
    await page.reload();
    await expect(
      page.getByText(/This workspace is read-only because its owner is over/),
    ).toBeVisible();
    const postAction = (action: string, data: object) =>
      page.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: { action, data },
      });
    expect(
      (await postAction('note.create', { domainId: secondDomain.id, body: 'A note' })).status(),
    ).toBe(409);
    expect((await page.request.get('/api/export')).status()).toBe(200);
    expect((await postAction('domain.delete', { id: firstDomain.id })).status()).toBe(200);
    expect(await (await page.request.get('/api/console?view=workspaceRestriction')).json()).toEqual(
      { restricted: false },
    );
    expect(
      (await postAction('note.create', { domainId: secondDomain.id, body: 'A note' })).status(),
    ).toBe(200);
    await chooseTheme(page, 'dark');
    const desiredTheme = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );
    await expect
      .poll(
        async () =>
          (
            await db.userPreference.findUnique({
              where: { userId: (await db.user.findUniqueOrThrow({ where: { email } })).id },
            })
          )?.theme,
      )
      .toBe(desiredTheme);
    const newDeviceState = await page.context().storageState();
    newDeviceState.origins = [];
    const newDevice = await page.context().browser()!.newContext({ storageState: newDeviceState });
    const devicePage = await newDevice.newPage();
    await devicePage.goto(browserUrl('/overview'));
    await expect(devicePage.locator('html')).toHaveClass(new RegExp(desiredTheme));
    await devicePage.goto(browserUrl('/settings?tab=preferences'));
    await chooseTheme(devicePage, 'system');
    await expect
      .poll(
        async () =>
          (
            await db.userPreference.findUnique({
              where: { userId: (await db.user.findUniqueOrThrow({ where: { email } })).id },
            })
          )?.theme,
      )
      .toBe('system');
    await devicePage.getByLabel('Enable in-app notifications').uncheck();
    await devicePage.getByRole('button', { name: 'Save preferences' }).click();
    await expect(devicePage.getByText('Preferences saved')).toBeVisible();
    await devicePage.reload();
    await expect(devicePage.getByRole('button', { name: /^Theme:/ }).first()).toHaveAttribute(
      'data-theme-choice',
      'system',
    );
    await expect(devicePage.getByLabel('Enable in-app notifications')).not.toBeChecked();
    await newDevice.close();
    if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
      const callback = browserUrl('/api/auth/callback/google?code=invalid&state=invalid');
      const blocked = await page.request.get(callback, { maxRedirects: 0 });
      expect(blocked.headers().location).toContain('OAuthLinkRequired');
      const noOrigin = await page.request.post('/api/account/oauth-link', {
        data: { provider: 'google' },
      });
      expect(noOrigin.status()).toBe(403);
      const start = await page.request.post('/api/account/oauth-link', {
        headers: { Origin: browserOrigin },
        data: { provider: 'google' },
      });
      expect(start.status()).toBe(200);
      const attempted = await page.request.get(callback, { maxRedirects: 0 });
      expect(attempted.headers().location).not.toContain('OAuthLinkRequired');
      const replay = await page.request.get(callback, { maxRedirects: 0 });
      expect(replay.headers().location).toContain('OAuthLinkRequired');
    }
    await page.getByRole('link', { name: 'View payment history' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history' })).toBeVisible();
    await expect(page.getByText('No verified transactions on this page.')).toBeVisible();
    await expect.poll(() => messages.length).toBe(3);
    expect(messages[2]).toContain('Your Assame password was changed');
    const otherContext = await page
      .context()
      .browser()!
      .newContext({ storageState: await page.context().storageState() });
    expect((await otherContext.request.get(browserUrl('/api/console?view=summary'))).status()).toBe(
      200,
    );
    await page.goto('/account/security');
    await page.getByLabel('Current password', { exact: true }).fill('AnotherBrowser!2026secure');
    await page.getByLabel('New password', { exact: true }).fill('FinalBrowser!2026secure');
    await page.getByLabel('Confirm new password').fill('FinalBrowser!2026secure');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await sendOneSecurityNotice()).toBe(true);
    await expect.poll(() => messages.length).toBe(4);
    expect(messages[3]).toContain('Your Assame password was changed');
    expect((await otherContext.request.get(browserUrl('/api/console?view=summary'))).status()).toBe(
      401,
    );
    await otherContext.close();
    await page.goto('/account/security');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('FinalBrowser!2026secure');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.authToken.create({
      data: {
        userId: user.id,
        kind: 'reset',
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const legacyChange = await page.request.post('/api/console', {
      headers: { Origin: browserOrigin },
      data: {
        action: 'password.change',
        data: { currentPassword: 'FinalBrowser!2026secure', password: 'LegacyUpdated!2026secure' },
      },
    });
    expect(legacyChange.status()).toBe(200);
    expect(await db.authToken.count({ where: { userId: user.id, kind: 'reset' } })).toBe(0);
    expect(await sendOneSecurityNotice()).toBe(true);
    await expect.poll(() => messages.length).toBe(5);
    expect(messages[4]).toContain('Your Assame password was changed');
    expect((await page.request.get('/api/console?view=summary')).status()).toBe(401);
  } finally {
    const user = await db.user.findUnique({ where: { email }, include: { members: true } });
    if (user) {
      await db.organization.deleteMany({
        where: { id: { in: user.members.map((member) => member.organizationId) } },
      });
      await db.user.delete({ where: { id: user.id } });
    }
    await new Promise<void>((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
