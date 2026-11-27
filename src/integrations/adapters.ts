import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { ProviderHttp } from './http';
import type { ProviderId } from './catalog';
import { AppError } from '@/lib/security';
import { atomAdapter } from './atom';
import { namecheapAdapter } from './namecheap';
import { atomRegistrarAdapter } from './atom-registrar';
import { godaddyAdapter } from './godaddy';
import { sedoAdapter } from './sedo';
export type Credentials = {
  apiKey: string;
  apiSecret?: string;
  userId?: string;
  apiUser?: string;
  clientIp?: string;
  accountPassword?: string;
};
export type RemoteDomain = {
  name: string;
  registrar?: string;
  expiresAt?: string;
  registeredAt?: string;
  nameservers?: string[];
  autoRenew?: boolean;
  marketplace?: string;
  listingType?: string;
  binPrice?: string;
  minOffer?: string;
  currency?: string;
  status?: string;
  lto?: { enabled: boolean; maxPeriod?: number };
  analytics?: { views?: number; leads?: number };
};
export interface Adapter {
  test(): Promise<void>;
  pages(): AsyncGenerator<RemoteDomain[]>;
  sales?(): AsyncGenerator<RemoteSale[]>;
  stats?(): Promise<{ date: string; views: number; leads: number }[]>;
}
export type RemoteSale = {
  externalId: string;
  domainName: string;
  status: string;
  kind: string;
  amount: string;
  currency: string;
  soldAt?: string;
  installments?: number;
  installmentsPaid?: number;
  commissionAmount?: string;
  installmentAmount?: string;
  nextInstallmentAt?: string;
  previousInstallmentAt?: string;
  disbursedAt?: string;
};
const amount = z.union([z.number(), z.string()]).transform((v) => new Decimal(v).toFixed(2));
const spaceItem = z.object({
  name: z.string(),
  expirationDate: z.string().optional(),
  registrationDate: z.string().optional(),
  nameservers: z.object({ hosts: z.array(z.string()) }).optional(),
  autoRenew: z.boolean().optional(),
});
const spaceListing = z.object({
  name: z.string(),
  status: z.string(),
  binPrice: z.object({ amount, currency: z.string() }).optional(),
  minPrice: z.object({ amount, currency: z.string() }).optional(),
  binPriceEnabled: z.boolean().optional(),
});
const aftItem = z.object({
  name: z.string(),
  buynowPrice: z.number().int().nonnegative().optional(),
  minbidPrice: z.number().int().nonnegative().optional(),
  listStatus: z.string(),
  intakeViews: z.number().optional(),
  intakeLeads: z.number().optional(),
  maxLeasePeriod: z.number().optional(),
  leasingEnabled: z.boolean().optional(),
});
export function afternicNormalize(raw: unknown): RemoteDomain {
  const item = aftItem.parse(raw);
  return {
    name: item.name,
    marketplace: 'afternic',
    binPrice:
      item.buynowPrice === undefined
        ? undefined
        : new Decimal(item.buynowPrice).div(1000000).toFixed(2),
    minOffer:
      item.minbidPrice === undefined
        ? undefined
        : new Decimal(item.minbidPrice).div(1000000).toFixed(2),
    currency: 'USD',
    status: item.listStatus,
    lto:
      item.leasingEnabled === undefined
        ? undefined
        : { enabled: item.leasingEnabled, maxPeriod: item.maxLeasePeriod },
    analytics: { views: item.intakeViews, leads: item.intakeLeads },
  };
}
export function adapter(provider: ProviderId, credential: Credentials): Adapter {
  if (provider === 'godaddy') return godaddyAdapter(credential);
  if (provider === 'atomRegistrar') return atomRegistrarAdapter(credential);
  if (provider === 'namecheap') return namecheapAdapter(credential);
  if (provider === 'sedo') return sedoAdapter(credential);
  if (provider === 'atom') return atomAdapter(credential);
  if (provider === 'afternic') {
    const client = new ProviderHttp(
      'https://api.afternic.com',
      { Authorization: `sso-key ${credential.apiKey}:${credential.apiSecret}` },
      500,
    );
    const path = '/v3/aftermarket/customers/my/domains';
    return {
      async test() {
        z.object({
          domains: z.array(aftItem),
          pagination: z.object({ total: z.number() }).passthrough(),
        }).parse(await client.get(path + '?limit=1&offset=0'));
      },
      async *pages() {
        for (let offset = 0; ; offset += 100) {
          const page = z
            .object({ domains: z.array(aftItem), pagination: z.object({ total: z.number() }) })
            .parse(await client.get(`${path}?limit=100&offset=${offset}&order=NAME_ASC`));
          yield page.domains.map(afternicNormalize);
          if (offset + page.domains.length >= page.pagination.total) break;
          if (!page.domains.length) throw new AppError('Incomplete Afternic pagination', 502);
        }
      },
      async *sales() {
        const item = z.object({
          transactionId: z.string(),
          name: z.string(),
          salePrice: z.number().int().nonnegative(),
          status: z.string(),
          saleType: z.string(),
          soldAt: z.string().optional(),
          totalInstallments: z.number().int().optional(),
          totalInstallmentsPaid: z.number().int().optional(),
          commission: z.number().int().nonnegative().optional(),
          installmentAmount: z.number().int().nonnegative().optional(),
          nextInstallmentDate: z.string().nullish(),
          prevInstallmentDate: z.string().nullish(),
          disbursedAt: z.string().nullish(),
        });
        for (let offset = 0; ; offset += 100) {
          const page = z
            .object({ sales: z.array(item), pagination: z.object({ total: z.number() }) })
            .parse(
              await client.get(
                `/v3/aftermarket/customers/my/sales?limit=100&offset=${offset}&order=NAME_ASC&soldAtStartDate=2000-01-01T00%3A00%3A00Z`,
              ),
            );
          yield page.sales.map((sale) => ({
            externalId: sale.transactionId,
            domainName: sale.name,
            status: sale.status,
            kind: sale.saleType,
            amount: new Decimal(sale.salePrice).div(1000000).toFixed(2),
            currency: 'USD',
            soldAt: sale.soldAt,
            installments: sale.totalInstallments,
            installmentsPaid: sale.totalInstallmentsPaid,
            commissionAmount:
              sale.commission === undefined
                ? undefined
                : new Decimal(sale.commission).div(1000000).toFixed(2),
            installmentAmount:
              sale.installmentAmount === undefined
                ? undefined
                : new Decimal(sale.installmentAmount).div(1000000).toFixed(2),
            nextInstallmentAt: sale.nextInstallmentDate || undefined,
            previousInstallmentAt: sale.prevInstallmentDate || undefined,
            disbursedAt: sale.disbursedAt || undefined,
          }));
          if (offset + page.sales.length >= page.pagination.total) break;
          if (!page.sales.length) throw new AppError('Incomplete Afternic sales pagination', 502);
        }
      },
      async stats() {
        return z
          .object({
            stats: z
              .array(
                z.object({
                  date: z.string(),
                  views: z.number().int().nonnegative(),
                  leads: z.number().int().nonnegative(),
                }),
              )
              .default([]),
          })
          .parse(await client.get('/v3/aftermarket/customers/my/stats?days=30')).stats;
      },
    };
  }
  if (provider === 'spaceship') {
    const client = new ProviderHttp(
      'https://spaceship.dev/api',
      { 'X-API-Key': credential.apiKey, 'X-API-Secret': credential.apiSecret! },
      1100,
    );
    return {
      async test() {
        z.object({ items: z.array(spaceItem), total: z.number() }).parse(
          await client.get('/v1/domains?take=1&skip=0'),
        );
        z.object({ items: z.array(spaceListing), total: z.number() }).parse(
          await client.get('/v1/sellerhub/domains?take=1&skip=0'),
        );
      },
      async *pages() {
        for (const kind of ['domains', 'sellerhub/domains']) {
          for (let skip = 0; ; skip += 100) {
            const raw = await client.get(`/v1/${kind}?take=100&skip=${skip}`);
            if (kind === 'domains') {
              const page = z.object({ items: z.array(spaceItem), total: z.number() }).parse(raw);
              yield page.items.map((d) => ({
                name: d.name,
                registrar: 'Spaceship',
                expiresAt: d.expirationDate,
                registeredAt: d.registrationDate,
                nameservers: d.nameservers?.hosts,
                autoRenew: d.autoRenew,
              }));
              if (skip + page.items.length >= page.total) break;
              if (!page.items.length) throw new AppError('Incomplete Spaceship pagination', 502);
            } else {
              const page = z.object({ items: z.array(spaceListing), total: z.number() }).parse(raw);
              yield page.items.map((d) => ({
                name: d.name,
                marketplace: 'spaceship',
                status: d.status,
                binPrice: d.binPriceEnabled === false ? undefined : d.binPrice?.amount,
                minOffer: d.minPrice?.amount,
                currency: d.binPrice?.currency || d.minPrice?.currency || 'USD',
              }));
              if (skip + page.items.length >= page.total) break;
              if (!page.items.length) throw new AppError('Incomplete SellerHub pagination', 502);
            }
          }
        }
      },
      async *sales() {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const item = z.object({
          name: z.string(),
          saleDateTime: z.string(),
          salePrice: z.object({ amount, currency: z.string() }),
        });
        do {
          const query = new URLSearchParams({ take: '100', ...(cursor ? { cursor } : {}) });
          const page = z
            .object({ items: z.array(item), cursor: z.string().nullish() })
            .parse(await client.get(`/v1/sellerhub/domains/reports/sold?${query}`));
          yield page.items.map((sale) => ({
            externalId: `${sale.name}:${sale.saleDateTime}`,
            domainName: sale.name,
            amount: sale.salePrice.amount,
            currency: sale.salePrice.currency,
            soldAt: sale.saleDateTime,
            status: 'reported sold',
            kind: 'SellerHub report',
          }));
          cursor = page.cursor || undefined;
          if (cursor && seen.has(cursor))
            throw new AppError('SellerHub repeated a pagination cursor', 502);
          if (cursor) seen.add(cursor);
        } while (cursor);
      },
    };
  }
  const client = new ProviderHttp('https://api.dynadot.com', {}, 2000);
  const path = `/api3.json?key=${encodeURIComponent(credential.apiKey)}&command=list_domain`;
  const domainRow = z.object({
    Name: z.string(),
    Expiration: z.union([z.string(), z.number()]).optional(),
    Registration: z.union([z.string(), z.number()]).optional(),
    isForSale: z.string().optional(),
  });
  const response = z.object({
    ListDomainInfoResponse: z
      .object({
        ResponseCode: z.union([z.number(), z.string()]),
        Status: z.string().optional(),
        Error: z.string().optional(),
        MainDomains: z.array(domainRow).optional(),
      })
      .optional(),
    Response: z
      .object({
        ResponseCode: z.union([z.number(), z.string()]).optional(),
        Error: z.string().optional(),
      })
      .optional(),
  });
  const restfulDomain = z.object({
    domain_name: z.string().optional(),
    name: z.string().optional(),
    Name: z.string().optional(),
    expiration_date: z.union([z.string(), z.number()]).optional(),
    expiration: z.union([z.string(), z.number()]).optional(),
    Expiration: z.union([z.string(), z.number()]).optional(),
    registration_date: z.union([z.string(), z.number()]).optional(),
    registration: z.union([z.string(), z.number()]).optional(),
    Registration: z.union([z.string(), z.number()]).optional(),
    is_for_sale: z.string().optional(),
    isForSale: z.string().optional(),
  });
  const restfulEnvelope = z.object({
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string().optional(),
    error: z
      .object({
        description: z.string().optional(),
      })
      .optional(),
    data: z
      .union([
        z.array(restfulDomain),
        z.object({
          domain_info_list: z.array(restfulDomain).optional(),
          domains: z.array(restfulDomain).optional(),
        }),
      ])
      .optional(),
  });
  function mapDynadotError(rawError: string | undefined): never {
    const lower = (rawError || '').toLowerCase();
    if (lower.includes('not authorized to access the api') || lower.includes('unauthorized ip') || lower.includes('ip ')) {
      throw new AppError(
        'Dynadot rejected this machine’s outbound IP address. Add your current outbound IP in Dynadot Tools → API Allowed IP List and retry.',
        400,
      );
    }
    if (lower.includes('x-signature')) {
      throw new AppError(
        'Dynadot requires your API Secret Key for RESTful v2 X-Signature signing. Enter both your Dynadot API Key and Secret Key.',
        400,
      );
    }
    if (lower.includes('signature')) {
      throw new AppError(
        'Dynadot rejected the X-Signature. Verify both your Dynadot API Key and Secret Key in Dynadot Tools → API.',
        400,
      );
    }
    if (lower.includes('invalid key') || lower.includes('invalid api key')) {
      throw new AppError(
        credential.apiSecret
          ? 'Dynadot rejected the API key. Check your API Key, Secret Key, and Allowed IP List in Dynadot Tools → API.'
          : 'Dynadot rejected the API key. If you generated a RESTful API Key, also enter your Dynadot Secret Key and allowlist your outbound IP in Dynadot Tools → API.',
        400,
      );
    }
    throw new AppError('Dynadot did not confirm inventory access. Check your API Key, Secret Key, and Allowed IP List in Dynadot Tools → API.', 502);
  }
  async function readRestful(secret: string): Promise<Array<z.infer<typeof domainRow>> | null> {
    const restfulPath = '/restful/v2/domains';
    const requestId = randomUUID();
    const stringToSign = `${credential.apiKey}\n${restfulPath}\n${requestId}\n`;
    const signature = createHmac('sha256', secret).update(stringToSign).digest('base64');
    const signedClient = new ProviderHttp(
      'https://api.dynadot.com',
      {
        Authorization: `Bearer ${credential.apiKey}`,
        'X-Request-Id': requestId,
        'X-Signature': signature,
      },
      2000,
    );
    let raw: unknown;
    try {
      raw = await signedClient.get(restfulPath);
    } catch (error) {
      if (error instanceof AppError && error.message.includes('HTTP 401')) {
        throw new AppError(
          'Dynadot rejected RESTful v2 authentication (HTTP 401). Ensure your outbound IP is allowlisted and your API Key + Secret Key match in Dynadot Tools → API.',
          400,
        );
      }
      throw error;
    }
    const parsed = restfulEnvelope.safeParse(raw);
    if (!parsed.success) return null;
    const body = parsed.data;
    const code = body.code !== undefined ? Number(body.code) : 200;
    const errDesc = body.error?.description || body.message;
    if (code === 200 && body.data !== undefined) {
      const list = Array.isArray(body.data)
        ? body.data
        : body.data.domain_info_list || body.data.domains || [];
      return list
        .map((item) => ({
          Name: item.Name || item.domain_name || item.name || '',
          Expiration: item.Expiration ?? item.expiration_date ?? item.expiration,
          Registration: item.Registration ?? item.registration_date ?? item.registration,
          isForSale: item.isForSale ?? item.is_for_sale,
        }))
        .filter((item) => Boolean(item.Name));
    }
    if (errDesc) mapDynadotError(errDesc);
    return null;
  }
  async function read() {
    const raw = await client.get(path);
    const parsed = response.safeParse(raw);
    if (parsed.success && parsed.data.ListDomainInfoResponse) {
      const data = parsed.data.ListDomainInfoResponse;
      if (String(data.ResponseCode) === '0' && data.Status === 'success' && data.MainDomains) {
        return data.MainDomains;
      }
      if (data.Error && !credential.apiSecret) {
        mapDynadotError(data.Error);
      }
    }
    if (credential.apiSecret) {
      const restfulRows = await readRestful(credential.apiSecret);
      if (restfulRows) return restfulRows;
    }
    if (parsed.success) {
      const err = parsed.data.ListDomainInfoResponse?.Error || parsed.data.Response?.Error;
      if (err) mapDynadotError(err);
    }
    throw new AppError('Dynadot did not confirm inventory access', 502);
  }
  function date(v: string | number | undefined) {
    if (v === undefined) return undefined;
    const d = new Date(/^\d+$/.test(String(v)) ? Number(v) : String(v));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return {
    async test() {
      await read();
    },
    async *pages() {
      const rows = await read();
      const listingClient = new ProviderHttp('https://api.dynadot.com', {}, 500);
      const results: RemoteDomain[] = [];
      for (const d of rows) {
        const isForSale = (d.isForSale || '').toLowerCase() === 'yes';
        let binPrice: string | undefined;
        if (isForSale) {
          try {
            const itemRes = await listingClient.get(
              `/api3.json?key=${encodeURIComponent(credential.apiKey)}&command=get_listing_item&domain=${encodeURIComponent(d.Name)}&currency=usd`,
            );
            const listingSchema = z.object({
              ResponseCode: z.coerce.number(),
              Status: z.string().optional(),
              Listing: z
                .object({
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
              .safeParse(itemRes);
            if (parsed.success) {
              const resp =
                parsed.data.GetListingsItemResponse ?? parsed.data.GetListingItemResponse;
              if (resp && resp.ResponseCode === 0 && resp.Listing?.Price) {
                const dec = new Decimal(resp.Listing.Price);
                if (dec.gt(0)) binPrice = dec.toFixed(2);
              }
            }
          } catch {
            // Listing state remains 'listed' even if the price call is unavailable
          }
        }
        results.push({
          name: d.Name,
          registrar: 'Dynadot',
          expiresAt: date(d.Expiration),
          registeredAt: date(d.Registration),
          ...(isForSale && {
            marketplace: 'dynadot',
            status: 'listed',
            binPrice,
            currency: 'USD',
          }),
        });
        if (results.length >= 25) {
          yield results.splice(0, results.length);
        }
      }
      if (results.length) yield results;
    },
  };
}
