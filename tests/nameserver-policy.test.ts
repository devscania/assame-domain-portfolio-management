import { describe, expect, it } from 'vitest';
import { nameserverEligibleAccounts } from '../src/lib/nameserver-policy';

const account = { id: 'same-workspace-account', providerId: 'namecheap', status: 'connected' };
const registration = { id: 'registration', registrar: 'Namecheap', providerAccountId: account.id,
  source: 'namecheap', verifiedAt: '2026-11-01T00:00:00Z' };
describe('actual registrar nameserver eligibility', () => {
  it('requires a verified exact account/source and supported registrar without conflicting evidence', () => {
    expect(nameserverEligibleAccounts([registration], [account])).toEqual([account]);
    for (const row of [
      { ...registration, providerAccountId: null }, { ...registration, providerAccountId: 'another-account' },
      { ...registration, source: 'manual' }, { ...registration, verifiedAt: null },
      { ...registration, verifiedAt: 'invalid' }, { ...registration, registrar: 'GoDaddy' },
    ]) expect(nameserverEligibleAccounts([row], [account])).toEqual([]);
    expect(nameserverEligibleAccounts([registration], [{ ...account, status: 'disconnected' }])).toEqual([]);
    expect(nameserverEligibleAccounts([registration, { ...registration, id: 'other', registrar: 'GoDaddy' }], [account])).toEqual([]);
  });
  it('never lets a supported account change an unrelated registrar domain', () => {
    expect(nameserverEligibleAccounts([{ ...registration, registrar: 'GoDaddy', source: 'godaddy' }], [account])).toEqual([]);
    expect(nameserverEligibleAccounts([{ ...registration, registrar: 'Spaceship', source: 'spaceship' }], [account])).toEqual([]);
    expect(nameserverEligibleAccounts([], [account])).toEqual([]);
  });
});
