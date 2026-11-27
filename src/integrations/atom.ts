import { createHash } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppError } from '@/lib/security';
import { normalizeDomain } from '@/lib/domain';
import { ProviderHttp } from './http';
import type { Adapter, Credentials, RemoteDomain } from './adapters';

// The published seller OpenAPI defines the endpoint/query parameters but leaves
// DomainApiResponse unresolved. Accept only explicit, validated listing records;
// unknown envelopes fail rather than implying an empty/successful portfolio.
export function atomPage(raw: unknown): {
  rows: RemoteDomain[];
  total?: number;
} {
  const object = z
    .record(z.string(), z.unknown())
    .safeParse(Array.isArray(raw) ? { domains: raw } : raw);
  if (!object.success)
    throw new AppError(
      'Atom returned an unrecognized listing response; no synchronization was confirmed.',
      502,
    );
  const body = object.data;
  if (
    body.success === false ||
    body.error ||
    ['error', 'failed', 'failure'].includes(String(body.status).toLowerCase())
  )
    throw new AppError(
      'Atom did not authorize the seller request. Check the seller API token, user ID and API approval.',
      403,
    );
  const data = Array.isArray(body.domains)
    ? body.domains
    : Array.isArray(body.data)
      ? body.data
      : undefined;
  if (!data)
    throw new AppError(
      'Atom listing response format is not supported yet; no synchronization was confirmed. The published seller specification omits its response schema.',
      502,
    );
  const listing = z.object({
    domain_name: z.string(),
    selling_price: z.union([z.string(), z.number()]).nullish(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    status: z.string().optional(),
    listing_type: z.string().nullish().catch(undefined),
  });
  const parsed = z.array(listing).safeParse(data);
  if (!parsed.success)
    throw new AppError(
      'Atom returned an unsupported listing record format; no synchronization was confirmed.',
      502,
    );
  const total = z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .safeParse(body.total_records ?? body.total);
  return {
    rows: parsed.data.map((item) => {
      const price = String(item.selling_price ?? '').trim();
      return {
        name: normalizeDomain(item.domain_name).name,
        marketplace: 'atom',
        status: item.status || 'unknown',
        listingType: item.listing_type ?? undefined,
        // Zero is returned for some approved Plus listings without a usable BIN.
        // Keep this unavailable rather than advertising the domain as free.
        binPrice:
          /^\d+(\.\d{1,2})?$/.test(price) && new Decimal(price).gt(0)
            ? new Decimal(price).toFixed(2)
            : undefined,
        currency: item.currency || 'USD',
      };
    }),
    total: total.success ? total.data : undefined,
  };
}

export function atomAdapter(
  credentials: Credentials,
  client = new ProviderHttp('https://www.atom.com/api/marketplace', {}, 1500),
): Adapter {
  if (!credentials.userId)
    throw new AppError('Atom requires your seller user ID as well as the API token.', 400);
  function path(page: number, limit: number) {
    const query = new URLSearchParams({
      api_token: credentials.apiKey,
      user_id: credentials.userId!,
      page: String(page),
      limit: String(limit),
    });
    return `/domains?${query}`;
  }
  return {
    async test() {
      atomPage(await client.get(path(1, 1)));
    },
    async *pages() {
      const seen = new Set<string>();
      let count = 0;
      for (let page = 1; page <= 10000; page++) {
        const result = atomPage(await client.get(path(page, 100)));
        if (!result.rows.length) {
          if (result.total !== undefined && count < result.total)
            throw new AppError(
              'Atom pagination ended before the reported total was retrieved.',
              502,
            );
          return;
        }
        const fingerprint = createHash('sha256')
          .update(
            result.rows
              .map((row) => row.name)
              .sort()
              .join('\n'),
          )
          .digest('hex');
        if (seen.has(fingerprint))
          throw new AppError('Atom repeated a listing page; synchronization is incomplete.', 502);
        seen.add(fingerprint);
        count += result.rows.length;
        yield result.rows;
        if (result.total !== undefined && count >= result.total) return;
      }
      throw new AppError('Atom pagination exceeded the safety limit.', 502);
    },
  };
}
