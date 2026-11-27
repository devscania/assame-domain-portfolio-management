import { providers, isProviderId, providerIdForName, type ProviderId } from '@/integrations/catalog';

export type NameserverAccount = { id: string; providerId: string; label?: string; status: string };
export type NameserverRegistration = { id: string; registrar: string; providerAccountId?: string | null; source?: string; verifiedAt?: string | Date | null };

export function supportsNameserverChanges(provider: string): provider is Extract<ProviderId, 'namecheap' | 'spaceship'> {
  return isProviderId(provider) && providers[provider].capabilities.manageNameservers;
}

/** Display eligibility only. The server repeats account/registration proof under
 * authorization locks and reads that registrar's current state before writing.
 * Conflicting registrar evidence is not resolved by picking an arbitrary row.
 */
export function nameserverEligibleAccounts(registrations: NameserverRegistration[], accounts: NameserverAccount[]) {
  const knownRegistrars = new Set(registrations.map((row) => providerIdForName(row.registrar)).filter(Boolean));
  if (knownRegistrars.size !== 1) return [];
  const eligible = accounts.filter((account) => account.status === 'connected' && supportsNameserverChanges(account.providerId) &&
    registrations.some((registration) => registration.providerAccountId === account.id &&
      registration.source === account.providerId && !!registration.verifiedAt &&
      Number.isFinite(new Date(registration.verifiedAt).getTime()) &&
      providerIdForName(registration.registrar) === account.providerId));
  return eligible.length === 1 ? eligible : [];
}
