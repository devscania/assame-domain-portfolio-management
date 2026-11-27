import Decimal from 'decimal.js';
import { z } from 'zod';
import { AppError } from '@/lib/security';
import { normalizeDomain } from '@/lib/domain';
import { afternicNormalize, type Credentials } from './adapters';
import { atomPage } from './atom';
import { ProviderHttp } from './http';
import { sedoClient } from './sedo';
export type PriceState = {
  name: string;
  price: string | null;
  currency: string;
  status: string;
  listingType?: string;
};
export type PriceProvider = 'afternic' | 'spaceship' | 'atom' | 'dynadot' | 'sedo';
export class AtomPriceRejection extends AppError {}

function atomLimit(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const amount = String(value).trim();
  if (!/^(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.00)?$/.test(amount)) return undefined;
  const dollars = Number(amount.replaceAll(',', ''));
  return dollars > 0 ? dollars : undefined;
}

function checkAtomPriceResponse(raw: string, httpRejected = false) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // An unknown response still requires an independent price read-back.
    return;
  }
  const parsed = z.record(z.string(), z.unknown()).safeParse(body);
  if (!parsed.success) return;
  const { success, status, error, message } = parsed.data;
  const detail = [message, error].filter((value) => typeof value === 'string').join(' ');
  const range =
    /(?:price|pricing).{0,80}(?:must be (?:within|between)|out(?:side)? of range|allowed range|cannot exceed)|(?:minimum|maximum) (?:allowed |selling )?price/i;
  const denied = /not authori[sz]ed|access denied|invalid (?:api|token)|permission denied/i;
  const rejected =
    success === false ||
    error === true ||
    (typeof error === 'string' && error.trim()) ||
    /^(?:error|failed|failure|rejected)$/i.test(String(status ?? '').trim()) ||
    /^(?:error\b|failed\b|unable to update\b|could not update\b|invalid (?:selling )?price\b)/i.test(
      detail.trim(),
    );
  if (denied.test(detail))
    throw new AtomPriceRejection(
      'Atom denied the price update. Check that your seller API token has pricing access.',
      403,
    );
  const minPrice = atomLimit(parsed.data.min_price ?? parsed.data.minimum_price);
  const maxPrice = atomLimit(parsed.data.max_price ?? parsed.data.maximum_price);
  if (range.test(detail) || rejected || (httpRejected && (minPrice || maxPrice))) {
    const amount = '(?:USD\\s*|\\$\\s*)?([\\d,]+(?:\\.\\d+)?)(?![\\d,]|\\.\\d)';
    const bounds = detail.match(
      new RegExp(`(?:price|pricing).{0,40}\\bbetween\\s+${amount}\\s+(?:and|to)\\s+${amount}`, 'i'),
    );
    const minimum =
      minPrice ??
      atomLimit(bounds?.[1]) ??
      atomLimit(
        detail.match(
          new RegExp(`\\bminimum (?:allowed |selling )?price\\s*(?:is|:|=)?\\s*${amount}`, 'i'),
        )?.[1],
      );
    const maximum =
      maxPrice ??
      atomLimit(bounds?.[2]) ??
      atomLimit(
        detail.match(
          new RegExp(
            `\\b(?:maximum (?:allowed |selling )?price\\s*(?:is|:|=)?|(?:selling )?price\\s+cannot exceed)\\s*${amount}`,
            'i',
          ),
        )?.[1],
      );
    const usd = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    if (minimum && maximum && minimum <= maximum)
      throw new AtomPriceRejection(
        `Atom rejected the price. Enter a price between ${usd.format(minimum)} and ${usd.format(maximum)}.`,
        400,
      );
    if (maximum && !minimum)
      throw new AtomPriceRejection(
        `Atom rejected the price. Enter ${usd.format(maximum)} or less.`,
        400,
      );
    if (minimum && !maximum)
      throw new AtomPriceRejection(
        `Atom rejected the price. Enter ${usd.format(minimum)} or more.`,
        400,
      );
    throw new AtomPriceRejection(
      range.test(detail)
        ? 'Atom rejected the price. Check the listing’s allowed price range in your Atom seller dashboard.'
        : 'Atom rejected the price update. Review the listing’s pricing rules and API access in Atom.',
      400,
    );
  }
}
export function validateListingPrice(provider: string, price: string, currency: string) {
  const amount = new Decimal(price);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2)
    throw new AppError('BIN price must be positive with at most two decimal places');
  if (
    provider === 'afternic' &&
    (currency !== 'USD' || !amount.isInteger() || amount.gt('49999999'))
  )
    throw new AppError('Afternic BIN prices must be whole USD amounts up to 49,999,999');
  if (provider === 'atom' && (currency !== 'USD' || !amount.isInteger()))
    throw new AppError('Atom selling prices must be whole USD amounts');
  if (provider === 'dynadot' && (currency !== 'USD' || amount.lte(0)))
    throw new AppError('Dynadot BIN prices must be positive USD amounts');
}
export function samePrice(a: string | null, b: string | null) {
  return a === null || b === null ? a === b : new Decimal(a).eq(b);
}
export function priceClient(provider: PriceProvider, credential: Credentials) {
  const sedo = provider === 'sedo' ? sedoClient(credential) : undefined;
  const client =
    provider === 'afternic'
      ? new ProviderHttp(
          'https://api.afternic.com',
          { Authorization: `sso-key ${credential.apiKey}:${credential.apiSecret}` },
          500,
        )
      : provider === 'spaceship'
        ? new ProviderHttp(
            'https://spaceship.dev/api',
            { 'X-API-Key': credential.apiKey, 'X-API-Secret': credential.apiSecret! },
            1100,
          )
        : provider === 'dynadot'
          ? new ProviderHttp('https://api.dynadot.com', {}, 1000)
          : new ProviderHttp('https://www.atom.com/api/marketplace', {}, 1500);
  function atomQuery(name: string) {
    if (!credential.userId) throw new AppError('Atom seller user ID is required');
    return new URLSearchParams({
      api_token: credential.apiKey,
      user_id: credential.userId,
      domain_name: name,
    });
  }
  return {
    async read(input: string): Promise<PriceState> {
      const name = normalizeDomain(input).name;
      if (sedo) {
        const listing = await sedo.listing(name);
        if (!listing) throw new AppError('Sedo did not return an active listing for this domain.', 404);
        return listing;
      }
      if (provider === 'afternic') {
        const row = afternicNormalize(
          await client.get(`/v3/aftermarket/customers/my/domains/${encodeURIComponent(name)}`),
        );
        if (normalizeDomain(row.name).name !== name)
          throw new AppError('Provider returned a different domain', 502);
        return {
          name,
          price: row.binPrice ?? null,
          currency: 'USD',
          status: row.status || 'unknown',
        };
      }
      if (provider === 'spaceship') {
        const row = z
          .object({
            name: z.string(),
            status: z.string(),
            binPriceEnabled: z.boolean().optional(),
            binPrice: z.object({ amount: z.string(), currency: z.string() }).optional(),
          })
          .parse(await client.get(`/v1/sellerhub/domains/${encodeURIComponent(name)}`));
        if (normalizeDomain(row.name).name !== name)
          throw new AppError('Provider returned a different domain', 502);
        return {
          name,
          price:
            row.binPriceEnabled === false
              ? null
              : row.binPrice
                ? new Decimal(row.binPrice.amount).toFixed(2)
                : null,
          currency: row.binPrice?.currency || 'USD',
          status: row.status,
        };
      }
      if (provider === 'dynadot') {
        const raw = await client.get(
          `/api3.json?key=${encodeURIComponent(credential.apiKey)}&command=get_listing_item&domain=${encodeURIComponent(name)}&currency=usd`,
        );
        const listingSchema = z.object({
          ResponseCode: z.coerce.number(),
          Status: z.string().optional(),
          Listing: z
            .object({
              Domain: z.string().optional(),
              Price: z.union([z.string(), z.number()]).optional(),
              Type: z.string().optional(),
            })
            .optional(),
        });
        const parsed = z
          .object({
            GetListingsItemResponse: listingSchema.optional(),
            GetListingItemResponse: listingSchema.optional(),
          })
          .safeParse(raw);
        if (!parsed.success) throw new AppError('Dynadot did not return listing details', 502);
        const resp = parsed.data.GetListingsItemResponse ?? parsed.data.GetListingItemResponse;
        if (!resp || resp.ResponseCode !== 0 || !resp.Listing)
          throw new AppError('Dynadot did not confirm this listing', 404);
        return {
          name,
          price: resp.Listing.Price ? new Decimal(resp.Listing.Price).toFixed(2) : null,
          currency: 'USD',
          status: 'listed',
        };
      }
      const raw = await client.get('/domain-details?' + atomQuery(name));
      const rows = atomPage(
        Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object' && 'domain_name' in raw
            ? [raw]
            : raw,
      ).rows;
      const row = rows.find((item) => item.name === name);
      if (!row) throw new AppError('Atom did not return this listing', 502);
      return {
        name,
        price: row.binPrice ?? null,
        currency: row.currency || 'USD',
        status: row.status || 'unknown',
        listingType: row.listingType,
      };
    },
    async update(name: string, price: string, currency: string) {
      validateListingPrice(provider, price, currency);
      name = normalizeDomain(name).name;
      if (sedo) await sedo.update(name, price, currency);
      else if (provider === 'afternic')
        await client.mutate(
          'PATCH',
          `/v3/aftermarket/customers/my/domains/${encodeURIComponent(name)}`,
          { buynowPrice: new Decimal(price).times(1000000).toNumber() },
        );
      else if (provider === 'spaceship')
        await client.mutate('PATCH', `/v1/sellerhub/domains/${encodeURIComponent(name)}`, {
          binPriceEnabled: true,
          binPrice: { amount: new Decimal(price).toFixed(2), currency },
        });
      else if (provider === 'dynadot') {
        const query = new URLSearchParams({
          key: credential.apiKey,
          command: 'set_for_sale',
          domains: name,
          for_sale_type: 'marketplace',
          category: 'other',
          listing_type: 'buy_now',
          price: new Decimal(price).toFixed(2),
          minimum_offer: '0',
          installment: 'No',
          currency: 'USD',
        });
        const raw = await client.mutateJson('GET', '/api3.json?' + query);
        const parsed = z
          .object({
            SetForSaleResponse: z
              .object({
                ResponseCode: z.coerce.number(),
                Status: z.string().optional(),
                Error: z.string().optional(),
              })
              .optional(),
          })
          .safeParse(raw);
        const resp = parsed.success ? parsed.data.SetForSaleResponse : undefined;
        if (!resp)
          throw new AppError(
            'Provider update response is uncertain. Remote verification is required before retrying.',
            502,
          );
        if (resp.ResponseCode !== 0) {
          throw new AppError(
            'Dynadot rejected the price update. Check the listing and API permissions.',
            400,
          );
        }
      } else {
        const query = atomQuery(name);
        query.set('selling_price', new Decimal(price).toFixed(0));
        checkAtomPriceResponse(
          await client.mutateText('GET', '/update-selling-price?' + query, (body) =>
            checkAtomPriceResponse(body, true),
          ),
        );
      }
    },
  };
}
