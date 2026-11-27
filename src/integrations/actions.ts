import { z } from 'zod';
import Decimal from 'decimal.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError } from '@/lib/security';
import { normalizeDomain } from '@/lib/domain';
import { ProviderHttp } from './http';
import { atomAdapter } from './atom';
import { sedoClient } from './sedo';
import { afternicNormalize, type Credentials } from './adapters';
import { validateListingPrice } from './prices';
import type { ProviderId } from './catalog';
import { removeSpaceshipListing } from './delisting';
import { reserveSpaceshipDomainRequest } from '@/lib/spaceship-request-budget';

export const actionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('removeListing'),
    domainId: z.string().min(1),
    accountId: z.string().min(1),
  }),
  z.object({
    action: z.literal('changeNameservers'),
    domainId: z.string().min(1),
    accountId: z.string().min(1),
    nameservers: z
      .array(
        z
          .string()
          .trim()
          .transform((v) => v.toLowerCase().replace(/\.$/, ''))
          .refine((v) => {
            try {
              return normalizeDomain(v).name === v;
            } catch {
              return false;
            }
          }, 'Enter a valid nameserver hostname'),
      )
      .min(2)
      .max(12)
      .refine((v) => new Set(v).size === v.length, 'Nameservers must be unique')
      .transform((v) => v.sort()),
  }),
  z.object({
    action: z.literal('addListing'),
    domainId: z.string().min(1),
    accountId: z.string().min(1),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/),
    currency: z.literal('USD').default('USD'),
  }),

]);
export type ActionInput = z.infer<typeof actionInput>;
export type RemoteListing = {
  name: string;
  price: string | null;
  currency: string;
  status: string;
  listingId?: string;
  listingType?: string;
};
export type RegistrarNameservers = string[] | { provider: 'basic' | 'custom'; hosts: string[] };
/** Local guard failed before any mutation was sent. */
export class ProviderMutationNotSentError extends AppError {
  constructor() { super('Spaceship request capacity is unavailable. Wait and try a fresh preview.', 429); }
}
const decimal = z.union([z.string(), z.number()]).transform((v) => new Decimal(v).toFixed(2));

export function actionClient(
  provider: ProviderId,
  c: Credentials,
  transport?: ProviderHttp,
  reserveDomainRequest = reserveSpaceshipDomainRequest,
) {
  let prepaidVerification: { name: string; until: number } | null = null;
  const http =
    transport ??
    (provider === 'afternic'
      ? new ProviderHttp(
          'https://api.afternic.com',
          { Authorization: `sso-key ${c.apiKey}:${c.apiSecret}` },
          500,
        )
      : provider === 'spaceship'
        ? new ProviderHttp(
            'https://spaceship.dev/api',
            { 'X-API-Key': c.apiKey, 'X-API-Secret': c.apiSecret! },
            1100,
          )
        : provider === 'dynadot'
          ? new ProviderHttp('https://api.dynadot.com', {}, 2000)
          : provider === 'atomRegistrar'
            ? new ProviderHttp(
                'https://www.atom.com/api',
                { Authorization: `Bearer ${c.apiKey}` },
                1500,
              )
            : provider === 'namecheap'
              ? new ProviderHttp('https://api.namecheap.com', {}, 6000)
              : new ProviderHttp('https://www.atom.com/api/marketplace', {}, 1500));
  const dyn = (command: string, name: string) =>
    '/api3.json?' + new URLSearchParams({ key: c.apiKey, command, domain: name });
  async function dynInfo(name: string) {
    const parsed = z
      .object({
        DomainInfoResponse: z.object({
          ResponseCode: z.coerce.number(),
          Status: z.string(),
          DomainInfo: z.object({ Name: z.string(), isForSale: z.string(), Status: z.string().optional() }),
        }),
      })
      .parse(await http.get(dyn('domain_info', name))).DomainInfoResponse;
    if (
      parsed.ResponseCode !== 0 ||
      parsed.Status.toLowerCase() !== 'success' ||
      normalizeDomain(parsed.DomainInfo.Name).name !== name
    )
      throw new AppError(
        'Dynadot did not confirm this domain belongs to the connected registrar account.',
        409,
      );
    return parsed.DomainInfo;
  }
  function namecheapQuery(command: string, name: string, extra: Record<string, string> = {}) {
    if (!c.apiUser || !c.clientIp)
      throw new AppError('Namecheap API username and allowlisted client IP are required', 409);
    const [SLD, ...parts] = name.split('.');
    return (
      '/xml.response?' +
      new URLSearchParams({
        ApiUser: c.apiUser,
        ApiKey: c.apiKey,
        UserName: c.apiUser,
        ClientIp: c.clientIp,
        Command: command,
        SLD,
        TLD: parts.join('.'),
        ...extra,
      })
    );
  }
  function namecheapResult(xml: string, key: string, name: string) {
    if (xml.length > 2_000_000 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new AppError('Namecheap returned invalid nameserver confirmation data.', 502);
    const response = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      isArray: (n) => n === 'Nameserver',
    }).parse(xml)?.ApiResponse;
    const result = response?.CommandResponse?.[key];
    if (
      response?.['@_Status'] !== 'OK' ||
      !result ||
      typeof result['@_Domain'] !== 'string' ||
      result['@_Domain'].toLowerCase() !== name
    )
      throw new AppError('Namecheap did not confirm the requested domain and operation.', 502);
    return result;
  }
  const sedo = provider === 'sedo' ? sedoClient(c, transport) : undefined;
  return {
    async removeListing(name: string, listing?: RemoteListing) {
      name = normalizeDomain(name).name;
      if (sedo) await sedo.remove(name);
      else if (provider === 'atom') {
        if (listing?.name !== name || listing.listingType !== 'standard')
          throw new AppError('Atom API delisting requires a verified Standard listing.', 409);
        if (!c.userId) throw new AppError('Atom seller user ID is required');
        await http.mutate('GET', '/remove-domain?' + new URLSearchParams({
          api_token: c.apiKey, user_id: c.userId, domain_name: name,
        }));
      }
      else if (provider === 'spaceship') await removeSpaceshipListing(http, name);
      else if (provider === 'afternic')
        await http.mutate('DELETE', '/v3/aftermarket/customers/my/domains/' + encodeURIComponent(normalizeDomain(name).name));
      else if (provider === 'dynadot') {
        const query = new URLSearchParams({
          key: c.apiKey,
          command: 'set_for_sale',
          domains: normalizeDomain(name).name,
          for_sale_type: 'not_for_sale',
        });
        const result = z.object({ SetForSaleResponse: z.object({
          ResponseCode: z.coerce.number(), Status: z.string().optional(),
        }) }).parse(await http.mutateJson('GET', `/api3.json?${query}`)).SetForSaleResponse;
        if (result.ResponseCode !== 0 || (result.Status && result.Status.toLowerCase() !== 'success'))
          throw new AppError('Dynadot did not confirm the listing removal request.', 502);
      }
      else throw new AppError('Delisting is unavailable for this provider', 409);
    },
    async nameservers(name: string): Promise<RegistrarNameservers> {
      if (provider === 'spaceship') {
        const result = z.object({
          name: z.string(),
          nameservers: z.object({
            provider: z.enum(['basic', 'custom']),
            hosts: z.array(z.string().min(1).max(253)).min(2).max(12),
          }),
        }).parse(await http.get(`/v1/domains/${encodeURIComponent(name)}`, async () => {
          if (prepaidVerification?.name === name && performance.now() <= prepaidVerification.until)
            prepaidVerification = null;
          else {
            prepaidVerification = null;
            await reserveDomainRequest(name, 'read');
          }
        }));
        if (normalizeDomain(result.name).name !== name)
          throw new AppError('Spaceship returned a different domain.', 502);
        const hosts = result.nameservers.hosts.map((host) => host.toLowerCase().replace(/\.$/, '')).sort();
        if (new Set(hosts).size !== hosts.length)
          throw new AppError('Spaceship returned invalid nameservers.', 502);
        return { provider: result.nameservers.provider, hosts };
      }
      if (provider !== 'namecheap')
        throw new AppError('Nameserver changes are unavailable for this provider', 409);
      const xml = await http.getText(namecheapQuery('namecheap.domains.dns.getList', name));
      const result = namecheapResult(xml, 'DomainDNSGetListResult', name);
      const hosts = z
        .array(z.string())
        .min(2)
        .max(12)
        .parse(result.Nameserver)
        .map((v) => v.toLowerCase().replace(/\.$/, ''))
        .sort();
      if (new Set(hosts).size !== hosts.length)
        throw new AppError('Namecheap returned invalid nameservers', 502);
      return hosts;
    },
    async setNameservers(name: string, hosts: string[]) {
      if (provider === 'spaceship') {
        // Reserve one read before writing so verification has capacity even if
        // another preview consumes the remainder of the rolling request budget.
        try {
          // Count the reserved read 60s into the future. It can only be reused
          // within 55s of return; later verification reserves a fresh slot.
          await reserveDomainRequest(name, 'read', true);
          prepaidVerification = { name, until: performance.now() + 55000 };
          await reserveDomainRequest(name, 'write');
        } catch {
          throw new ProviderMutationNotSentError();
        }
        await http.mutate('PUT', `/v1/domains/${encodeURIComponent(name)}/nameservers`, {
          provider: 'custom', hosts,
        });
        return;
      }
      if (provider !== 'namecheap')
        throw new AppError('Nameserver changes are unavailable for this provider', 409);
      const xml = await http.mutateText(
        'GET',
        namecheapQuery('namecheap.domains.dns.setCustom', name, { Nameservers: hosts.join(',') }),
      );
      const result = namecheapResult(xml, 'DomainDNSSetCustomResult', name);
      if (String(result['@_Updated']).toLowerCase() !== 'true')
        throw new AppError('Namecheap did not confirm the nameserver update', 502);
    },
    async listing(name: string, purpose?: 'remove'): Promise<RemoteListing | null> {
      if (sedo) return sedo.listing(name);
      if (provider === 'afternic') {
        const raw = await http.getOptional(
          '/v3/aftermarket/customers/my/domains/' + encodeURIComponent(name),
        );
        if (raw === null) return null;
        const item = afternicNormalize(raw);
        if (normalizeDomain(item.name).name !== name)
          throw new AppError('Provider returned another domain', 502);
        return { name, price: item.binPrice ?? null, currency: 'USD', status: item.status! };
      }
      if (provider === 'spaceship') {
        const raw = await http.getOptional('/v1/sellerhub/domains/' + encodeURIComponent(name));
        if (raw === null) return null;
        const item = z
          .object({
            name: z.string(),
            status: z.string(),
            binPriceEnabled: z.boolean().optional(),
            binPrice: z.object({ amount: decimal, currency: z.string() }).optional(),
          })
          .parse(raw);
        if (normalizeDomain(item.name).name !== name)
          throw new AppError('Provider returned another domain', 502);
        return {
          name,
          price: item.binPriceEnabled === false ? null : (item.binPrice?.amount ?? null),
          currency: item.binPrice?.currency ?? 'USD',
          status: item.status,
        };
      }
      if (provider === 'atom') {
        for await (const page of atomAdapter(c, http).pages()) {
          const item = page.find((d) => d.name === name);
          if (item)
            return {
              name,
              price: item.binPrice ?? null,
              currency: item.currency ?? 'USD',
              status: item.status!,
              ...(purpose === 'remove' ? { listingType: item.listingType?.trim().toLowerCase() } : {}),
            };
        }
        return null;
      }
      if (provider === 'dynadot') {
        const info = await dynInfo(name);
        if (purpose === 'remove' && info.Status?.toLowerCase() !== 'active')
          throw new AppError('Dynadot did not confirm an active registrar domain.', 409);
        if (info.isForSale.toLowerCase() === 'no') return null;
        if (info.isForSale.toLowerCase() !== 'yes')
          throw new AppError('Dynadot listing state is unavailable', 502);
        const itemRes = await http.get(dyn('get_listing_item', name) + '&currency=usd');
        const listingSchema = z.object({
          ResponseCode: z.coerce.number(),
          Status: z.string().optional(),
          Listing: z.object({
            Domain: z.string().optional(),
            Price: decimal.optional(),
            Type: z.string().optional(),
            ListingId: z.string().optional(),
            PendingSaleLocked: z.string().optional(),
          }),
        });
        const parsed = z
          .object({
            GetListingsItemResponse: listingSchema.optional(),
            GetListingItemResponse: listingSchema.optional(),
          })
          .safeParse(itemRes);
        const response = parsed.success
          ? (parsed.data.GetListingsItemResponse ?? parsed.data.GetListingItemResponse)
          : undefined;
        if (
          !response ||
          response.ResponseCode !== 0 ||
          (response.Listing.Domain && normalizeDomain(response.Listing.Domain).name !== name)
        )
          throw new AppError('Dynadot did not confirm listing details', 502);
        const type = (response.Listing.Type || '').toLowerCase();
        if (purpose === 'remove' && (
          response.Status?.toLowerCase() !== 'success' ||
          !response.Listing.Domain || !response.Listing.ListingId ||
          response.Listing.PendingSaleLocked?.toLowerCase() !== 'no' ||
          !['bin', 'make_offer', 'buy_now', 'buy_now_and_make_offer'].includes(type)
        ))
          throw new AppError('Dynadot did not confirm an eligible, unlocked marketplace listing.', 409);
        const hasBin =
          type.includes('buy now') ||
          type.includes('bin') ||
          (response.Listing.Price && new Decimal(response.Listing.Price).gt(0));
        return {
          name,
          price: hasBin && response.Listing.Price ? response.Listing.Price : null,
          currency: 'USD',
          status: 'listed',
          ...(purpose === 'remove' ? { listingId: response.Listing.ListingId, listingType: type } : {}),
        };
      }
      throw new AppError('Listing creation is unsupported for this provider', 409);
    },
    async addListing(name: string, price: string) {
      validateListingPrice(provider, price, 'USD');
      if (sedo) await sedo.add(normalizeDomain(name).name, price);
      else if (provider === 'afternic')
        await http.mutate('POST', '/v3/aftermarket/customers/my/domains', {
          name,
          buynowPrice: new Decimal(price).mul(1000000).toNumber(),
        });
      else if (provider === 'spaceship')
        await http.mutate('POST', '/v1/sellerhub/domains', {
          name,
          binPriceEnabled: true,
          binPrice: { amount: new Decimal(price).toFixed(2), currency: 'USD' },
        });
      else if (provider === 'atom') {
        if (!c.userId) throw new AppError('Atom seller user ID is required');
        await http.mutate(
          'GET',
          '/add-domain?' +
            new URLSearchParams({
              api_token: c.apiKey,
              user_id: c.userId,
              domain_type: 'standard',
              domain_name: name,
              price: new Decimal(price).toFixed(0),
            }),
        );
      } else if (provider === 'dynadot') {
        const query = new URLSearchParams({
          key: c.apiKey,
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
        const raw = await http.mutateJson('GET', '/api3.json?' + query);
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
          throw new AppError('Dynadot rejected listing creation. Check the domain and API permissions.', 400);
        }
      } else throw new AppError('Listing creation is unsupported for this provider', 409);
    },
  };
}
