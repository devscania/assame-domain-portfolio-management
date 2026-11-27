import { isLoopbackFixtureDatabase } from '../../scripts/synthetic-database';
/** One origin for navigation, CSRF headers, cookies, callback and email fixtures. */
export const browserOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010')
  .origin;
export const browserHost = new URL(browserOrigin).hostname;
export const browserSmtpPort = Number(process.env.SMTP_PORT || 2526);
export const browserUrl = (path: string) => new URL(path, browserOrigin).toString();

export function assertBrowserEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const invalid: string[] = [];
  const base = new URL(env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010');
  if (
    base.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !base.port
  )
    invalid.push('PLAYWRIGHT_BASE_URL must be an explicit loopback HTTP origin');
  if (env.AUTH_URL !== base.origin) invalid.push('AUTH_URL must match PLAYWRIGHT_BASE_URL');
  if (!env.TEST_DATABASE_URL || env.DATABASE_URL !== env.TEST_DATABASE_URL)
    invalid.push('DATABASE_URL and TEST_DATABASE_URL must identify the same disposable database');
  if (!isLoopbackFixtureDatabase(env.TEST_DATABASE_URL))
    invalid.push(
      'TEST_DATABASE_URL must identify a loopback fixture database without connection overrides',
    );
  if (
    env.SMTP_HOST !== '127.0.0.1' ||
    env.SMTP_REQUIRE_TLS !== 'false' ||
    env.SMTP_USER ||
    env.SMTP_PASSWORD ||
    !Number.isInteger(Number(env.SMTP_PORT || 2526)) ||
    Number(env.SMTP_PORT || 2526) < 1024 ||
    Number(env.SMTP_PORT || 2526) > 65535 ||
    !env.SMTP_FROM
  )
    invalid.push('SMTP must use the local unauthenticated fixture and an unprivileged port');
  if (env.DEMO_MODE !== 'true') invalid.push('Browser tests require synthetic demo fixtures');
  if (invalid.length) throw new Error(`Unsafe browser test configuration: ${invalid.join('; ')}`);
}
