import { Resolver } from 'node:dns/promises';
import { normalizeDomain } from './domain';

export function normalizeNameservers(values: unknown[]) {
  const hosts = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    try {
      hosts.add(normalizeDomain(value).name);
    } catch {
      // Public responses can contain incomplete or invalid hostname entries.
    }
  }
  return [...hosts].sort();
}

/** Read NS records only; never contacts or changes a registrar account. */
export async function lookupPublicNameservers(name: string) {
  const domain = normalizeDomain(name).name;
  const resolver = new Resolver({ timeout: 1500, tries: 2 });
  const deadline = setTimeout(() => resolver.cancel(), 4000);
  try {
    return normalizeNameservers(await resolver.resolveNs(domain));
  } catch {
    return [];
  } finally {
    clearTimeout(deadline);
  }
}
