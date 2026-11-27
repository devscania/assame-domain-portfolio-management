import { smtpConfiguration } from './smtp-config';

type Environment = Record<string, string | undefined>;

/** Validate required deployment configuration without printing secret values. */
export function validateRuntimeConfig(env: Environment) {
  if (env.NODE_ENV !== 'production') return;
  const invalid: string[] = [];
  try {
    const db = new URL(env.DATABASE_URL || '');
    if (
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      !db.hostname ||
      !db.pathname.slice(1) ||
      /^(?:local-development-only|replace-with.*|change-me)$/i.test(decodeURIComponent(db.password))
    )
      invalid.push('DATABASE_URL');
  } catch {
    invalid.push('DATABASE_URL');
  }
  try {
    const url = new URL(env.AUTH_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname)
      invalid.push('AUTH_URL');
  } catch {
    invalid.push('AUTH_URL');
  }
  if (
    !env.AUTH_SECRET ||
    env.AUTH_SECRET.length < 32 ||
    /replace-with|change-me/i.test(env.AUTH_SECRET)
  )
    invalid.push('AUTH_SECRET');
  if (!env.CREDENTIAL_ENCRYPTION_KEY || !/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_ENCRYPTION_KEY))
    invalid.push('CREDENTIAL_ENCRYPTION_KEY');
  if (env.DEMO_MODE === 'true') invalid.push('DEMO_MODE');
  const emailEnabled =
    ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD'].some((key) => Boolean(env[key])) ||
    env.WELCOME_EMAILS_ENABLED === 'true';
  if (emailEnabled) invalid.push(...smtpConfiguration(env).invalid);
  // A welcome notice is queued only at first verification or OAuth sign-in.
  // Enabling it later cannot recover notices for existing accounts.
  if (emailEnabled && env.WELCOME_EMAILS_ENABLED !== 'true') invalid.push('WELCOME_EMAILS_ENABLED');
  for (const provider of ['GOOGLE', 'DISCORD']) {
    if (Boolean(env[`AUTH_${provider}_ID`]) !== Boolean(env[`AUTH_${provider}_SECRET`]))
      invalid.push(`AUTH_${provider}_ID/AUTH_${provider}_SECRET`);
  }
  if (invalid.length)
    throw new Error(`Invalid production configuration: ${[...new Set(invalid)].join(', ')}`);
}
