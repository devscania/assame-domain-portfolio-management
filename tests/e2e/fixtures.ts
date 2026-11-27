import { browserOrigin, browserSmtpPort } from './environment';
import type { APIRequestContext } from '@playwright/test';
import { test as base, expect } from './browser-test';
import { SMTPServer } from 'smtp-server';
import { randomUUID } from 'node:crypto';

type Fixtures = {
  verifyFixtureEmail: (email: string, request: APIRequestContext) => Promise<void>;
};
export const test = base.extend<Fixtures>({
  page: async ({ page }, providePage) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `browser-fixture-${randomUUID()}` });
    await providePage(page);
  },
  verifyFixtureEmail: [
    async ({}, provideFixture) => {
      if (
        !process.env.TEST_DATABASE_URL ||
        process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL ||
        process.env.SMTP_HOST !== '127.0.0.1' ||
        Number(process.env.SMTP_PORT || 2526) !== browserSmtpPort ||
        process.env.SMTP_REQUIRE_TLS !== 'false'
      )
        throw new Error(
          'Browser fixtures require an isolated database and the configured local SMTP fixture',
        );
      const messages: { recipients: string[]; text: string }[] = [];
      const server = new SMTPServer({
        authOptional: true,
        disabledCommands: ['STARTTLS'],
        onData(stream, session, callback) {
          let text = '';
          stream.on('data', (chunk) => {
            text += chunk.toString();
          });
          stream.on('end', () => {
            messages.push({
              recipients: session.envelope.rcptTo.map((item) => item.address.toLowerCase()),
              text,
            });
            callback();
          });
        },
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(browserSmtpPort, '127.0.0.1', resolve);
      });
      try {
        await provideFixture(async (email, request) => {
          await expect
            .poll(() =>
              messages.some((message) => message.recipients.includes(email.toLowerCase())),
            )
            .toBe(true);
          const body = messages
            .findLast((message) => message.recipients.includes(email.toLowerCase()))!
            .text.replace(/=\r?\n/g, '');
          const token = body.match(/token(?:=3D|=)([A-Za-z0-9_-]{43})/i)?.[1];
          expect(token).toBeTruthy();
          const response = await request.post('/api/auth-email', {
            headers: { Origin: browserOrigin, 'x-forwarded-for': email },
            data: { action: 'verify', token },
          });
          expect(response.status()).toBe(200);
        });
      } finally {
        await new Promise<void>((resolve) => server.close(resolve));
      }
    },
    { auto: true },
  ],
});
export { expect };
