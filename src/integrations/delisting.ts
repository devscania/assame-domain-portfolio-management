import { normalizeDomain } from '@/lib/domain';
import { ProviderHttp } from './http';

/**
 * Sends the documented SellerHub deletion. The caller must first preview and
 * confirm the current listing, then re-read it after this call (including when
 * it throws) and never automatically resend an uncertain mutation.
 * https://docs.spaceship.dev/#tag/SellerHub/operation/deleteSellerHubDomain
 * Requires sellerhub:write; verification requires sellerhub:read.
 */
export async function removeSpaceshipListing(http: ProviderHttp, domain: string): Promise<void> {
  const name = normalizeDomain(domain).name;
  await http.mutate('DELETE', `/v1/sellerhub/domains/${encodeURIComponent(name)}`);
}
