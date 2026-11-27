import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { ProviderHttp } from './http';
import type { Adapter, Credentials, RemoteDomain } from './adapters';

const base = 'https://api.godaddy.com';
const path = '/v3/domains/domain-names';
const lifecycle = 'REGISTERED,PENDING_TERMINAL';
const timestamp = z.string().datetime({ offset: true });
const pageSchema = z.object({
  items: z.array(z.object({
    domain: z.string().min(1).max(253),
    status: z.string().min(1),
    expiresAt: timestamp.optional(),
    createdAt: timestamp.optional(),
    autoRenew: z.boolean().optional(),
    nameServers: z.array(z.string().min(1).max(253)).max(32).optional(),
  })).max(200),
  // The documented collection always carries navigation links. Omission is not
  // treated as proof that this is the final page.
  links: z.array(z.object({ rel: z.string(), href: z.string().max(4096), method: z.string().optional() })).max(20),
});

function requestPath(token?: string) {
  const query = new URLSearchParams({ pageSize: '200', lifecycleGroups: lifecycle });
  if (token) query.set('pageToken', token);
  return `${path}?${query}`;
}

/** Parse only the documented forward cursor. Never send a credential to a URL
 * or alternate endpoint supplied by a provider response.
 */
export function godaddyNextPath(links: z.infer<typeof pageSchema>['links']) {
  const next = links.filter((link) => link.rel === 'next');
  if (!next.length) return null;
  if (next.length !== 1 || (next[0].method && next[0].method !== 'GET'))
    throw new AppError('GoDaddy returned ambiguous pagination.', 502);
  let url: URL;
  try { url = new URL(next[0].href, base); } catch { throw new AppError('GoDaddy returned invalid pagination.', 502); }
  const query = url.searchParams;
  const keys = [...query.keys()];
  if (url.origin !== base || url.pathname !== path || url.username || url.password || url.hash ||
    keys.some((key) => !['pageSize', 'pageToken', 'pageTokenDirection', 'lifecycleGroups'].includes(key)) ||
    new Set(keys).size !== keys.length || !query.get('pageToken') ||
    (query.has('pageSize') && query.get('pageSize') !== '200') ||
    (query.has('lifecycleGroups') && query.get('lifecycleGroups') !== lifecycle) ||
    (query.has('pageTokenDirection') && query.get('pageTokenDirection') !== 'forward'))
    throw new AppError('GoDaddy returned unsupported pagination; no alternate URL was requested.', 502);
  return requestPath(query.get('pageToken')!);
}

export function godaddyAdapter(credential: Credentials, client?: ProviderHttp): Adapter {
  const token = z.string().trim().min(3).max(512).regex(/^\S+$/).safeParse(credential.apiKey);
  if (!token.success) throw new AppError('GoDaddy requires a Personal Access Token with domains.domain:read access.');
  const identity = createHash('sha256').update(token.data).digest('hex');
  const http = client ?? new ProviderHttp(base, { Authorization: `Bearer ${token.data}` }, 1400,
    undefined, undefined, () => throttle(`godaddy:${identity}:minute`, 40, 60));
  async function read(next: string) {
    const parsed = pageSchema.safeParse(await http.get(next));
    if (!parsed.success) throw new AppError('GoDaddy returned an incomplete or unsupported inventory response.', 502);
    return parsed.data;
  }
  return {
    async test() { await read(requestPath()); },
    async *pages() {
      let next: string | null = requestPath();
      const visited = new Set<string>(), seen = new Set<string>();
      while (next) {
        if (visited.has(next) || visited.size >= 10000)
          throw new AppError('GoDaddy inventory pagination did not finish safely.', 502);
        visited.add(next);
        const page = await read(next);
        next = godaddyNextPath(page.links);
        if (!page.items.length && next)
          throw new AppError('GoDaddy returned an empty non-final inventory page.', 502);
        const rows = page.items.map((item): RemoteDomain => {
          const key = item.domain.toLowerCase();
          if (seen.has(key)) throw new AppError('GoDaddy repeated inventory records; synchronization was not confirmed.', 502);
          seen.add(key);
          return { name: item.domain, registrar: 'GoDaddy', expiresAt: item.expiresAt,
            registeredAt: item.createdAt, autoRenew: item.autoRenew, nameservers: item.nameServers };
        });
        yield rows;
      }
    },
  };
}
