import { z } from 'zod';
export const oauthProviders = ['google', 'discord'] as const;
export type OAuthProvider = (typeof oauthProviders)[number];
export function providerEnabled(provider: OAuthProvider) {
  return provider === 'google'
    ? Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)
    : Boolean(process.env.AUTH_DISCORD_ID && process.env.AUTH_DISCORD_SECRET);
}
export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'discord';
}
export function verifiedOAuthProfile(provider: string, profile: unknown) {
  if (!isOAuthProvider(provider) || !profile || typeof profile !== 'object') return false;
  const p = profile as Record<string, unknown>;
  const email = z.email().max(254).safeParse(p.email);
  return (
    email.success &&
    (provider === 'google'
      ? p.email_verified === true && typeof p.sub === 'string' && p.sub.length > 0
      : p.verified === true && typeof p.id === 'string' && p.id.length > 0)
  );
}
