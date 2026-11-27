import { describe, expect, it } from 'vitest';
import { assertBrowserEnvironment } from './e2e/environment';

const isolated: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PLAYWRIGHT_BASE_URL: 'http://localhost:3012',
  AUTH_URL: 'http://localhost:3012',
  DATABASE_URL: 'postgresql://fixture@127.0.0.1:55524/browser_test',
  TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1:55524/browser_test',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '2532',
  SMTP_REQUIRE_TLS: 'false',
  SMTP_FROM: 'fixture@example.test',
  DEMO_MODE: 'true',
};
describe('browser fixture environment boundaries', () => {
  it('accepts an alternate loopback application and SMTP port', () => {
    expect(() => assertBrowserEnvironment(isolated)).not.toThrow();
  });
  it.each(['host=/private/socket', 'options=-c search_path=customer', 'schema=customer'])(
    'rejects database query overrides %s',
    (query) => {
      const connection = `${isolated.TEST_DATABASE_URL}?${query}`;
      expect(() =>
        assertBrowserEnvironment({
          ...isolated,
          DATABASE_URL: connection,
          TEST_DATABASE_URL: connection,
        }),
      ).toThrow('Unsafe browser test configuration');
    },
  );
  it.each([
    {
      PLAYWRIGHT_BASE_URL: 'https://portfolio.example.test',
      AUTH_URL: 'https://portfolio.example.test',
    },
    { AUTH_URL: 'http://localhost:3010' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1:55524/customer' },
    {
      DATABASE_URL: 'postgresql://fixture@remote.test/test',
      TEST_DATABASE_URL: 'postgresql://fixture@remote.test/test',
    },
    {
      DATABASE_URL: 'postgresql://fixture@127.0.0.1/customer',
      TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/customer',
    },
    { SMTP_HOST: 'smtp.remote.test' },
    { SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture' },
    { SMTP_PORT: '465' },
  ])('rejects unsafe or mismatched fixture configuration %#', (change) => {
    expect(() => assertBrowserEnvironment({ ...isolated, ...change })).toThrow(
      'Unsafe browser test configuration',
    );
  });
});
