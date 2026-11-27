import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from '../src/lib/runtime-config';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:secret@database.example/assame',
  AUTH_URL: 'https://portfolio.example.test',
  AUTH_SECRET: 'a'.repeat(40),
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  SMTP_HOST: 'smtp.example',
  SMTP_FROM: 'hello@example.test',
  WELCOME_EMAILS_ENABLED: 'true',
};
describe('production runtime configuration', () => {
  it('supports operator-created accounts with all email services disabled', () => {
    const configuration = {
      ...valid,
      SMTP_HOST: '',
      SMTP_FROM: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      WELCOME_EMAILS_ENABLED: 'false',
    };
    expect(() => validateRuntimeConfig(configuration)).not.toThrow();
    expect(() => validateRuntimeConfig({ ...configuration, SMTP_HOST: 'smtp.example' })).toThrow(
      'SMTP_FROM',
    );
  });
  it('does not require deployment credentials for local development', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
  it('accepts Spacemail with implicit TLS or required STARTTLS and rejects incomplete mailbox settings', () => {
    const spacemail = {
      ...valid,
      SMTP_HOST: 'mail.spacemail.com',
      SMTP_USER: 'hello@example.test',
      SMTP_PASSWORD: 'fixture-password',
      SMTP_FROM: 'Assame <hello@example.test>',
    };
    for (const port of ['465', '587']) {
      expect(() =>
        validateRuntimeConfig({ ...spacemail, SMTP_PORT: port, SMTP_REQUIRE_TLS: 'true' }),
      ).not.toThrow();
    }
    expect(() => validateRuntimeConfig({ ...spacemail, SMTP_USER: 'hello' })).toThrow(
      'SMTP_USER/SMTP_PASSWORD',
    );
    expect(() => validateRuntimeConfig({ ...spacemail, SMTP_PORT: '25' })).toThrow(
      'SMTP_PORT/SMTP_REQUIRE_TLS',
    );
    expect(() => validateRuntimeConfig({ ...spacemail, SMTP_FROM: 'Assame' })).toThrow('SMTP_FROM');
  });
  it('requires welcome notices in production before first account verification', () => {
    expect(() => validateRuntimeConfig({ ...valid, WELCOME_EMAILS_ENABLED: 'false' })).toThrow(
      'WELCOME_EMAILS_ENABLED',
    );
  });

  it('rejects insecure required configuration without exposing secret values', () => {
    try {
      validateRuntimeConfig({
        ...valid,
        AUTH_URL: 'http://example.test',
        AUTH_SECRET: 'known-secret',
        SMTP_REQUIRE_TLS: 'false',
        DEMO_MODE: 'true',
      });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect((error as Error).message).toContain('AUTH_URL');
      expect((error as Error).message).toContain('AUTH_SECRET');
      expect((error as Error).message).toContain('SMTP_PORT/SMTP_REQUIRE_TLS');
      expect((error as Error).message).not.toContain('known-secret');
    }
  });

  it('rejects a default database password and incomplete OAuth credentials', () => {
    expect(() =>
      validateRuntimeConfig({
        ...valid,
        DATABASE_URL: 'postgresql://app:local-development-only@db/app',
      }),
    ).toThrow('DATABASE_URL');
    expect(() =>
      validateRuntimeConfig({ ...valid, AUTH_GOOGLE_ID: 'configured-without-secret' }),
    ).toThrow('AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET');
    expect(() =>
      validateRuntimeConfig({ ...valid, AUTH_DISCORD_SECRET: 'configured-without-id' }),
    ).toThrow('AUTH_DISCORD_ID/AUTH_DISCORD_SECRET');
  });
});
