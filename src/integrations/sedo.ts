import Decimal from 'decimal.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { normalizeDomain } from '@/lib/domain';
import { AppError } from '@/lib/security';
import type { Adapter, Credentials, RemoteDomain } from './adapters';
import { ProviderHttp } from './http';

const currencies = { '0': 'EUR', '1': 'USD', '2': 'GBP' } as const;
const money = z.string().regex(/^\d+(\.\d+)?$/);
const domainRow = z.object({
  domain: z.string(),
  forsale: z.enum(['0', '1']),
  fixedprice: z.enum(['0', '1']),
  price: money,
  minprice: money,
  currency: z.enum(['0', '1', '2']),
  category: z.union([
    z.record(z.string(), z.string()),
    z.literal('').transform((): Record<string, string> => ({})),
  ]).optional(),
  domainlanguage: z.string().optional(),
});
type DomainRow = z.infer<typeof domainRow>;
const mutationRow = z.object({ domain: z.string(), status: z.string() });
const xmlParser = new XMLParser({
  parseTagValue: false,
  processEntities: false,
  isArray: (tag) => tag === 'item',
});

function readRows(xml: string, root: string): unknown[] {
  if (xml.length > 2_000_000 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new AppError('Sedo returned invalid XML.', 502);
  const parsed = xmlParser.parse(xml);
  if (parsed.SEDOFAULT !== undefined)
    throw new AppError('Sedo rejected the request. Check account access and listing restrictions.', 502);
  const envelope = z.object({ item: z.array(z.unknown()) }).safeParse(parsed[root]);
  if (envelope.success) return envelope.data.item;
  if (parsed[root] === '') return [];
  throw new AppError('Sedo returned an unrecognized response.', 502);
}

function amount(value: string) {
  return new Decimal(value).gt(0) ? new Decimal(value).toFixed(2) : undefined;
}

function normalize(row: DomainRow): RemoteDomain {
  return {
    name: normalizeDomain(row.domain).name,
    marketplace: 'sedo',
    status: row.forsale === '1' ? 'listed' : 'unlisted',
    binPrice: row.forsale === '1' && row.fixedprice === '1' ? amount(row.price) : undefined,
    minOffer: row.forsale === '1' ? amount(row.minprice) : undefined,
    currency: currencies[row.currency],
  };
}

export function sedoClient(credentials: Credentials, http = new ProviderHttp('https://api.sedo.com/api/v1', {}, 1000)) {
  function form(extra: Record<string, string>) {
    const { apiKey, apiSecret, apiUser, accountPassword } = credentials;
    if (!/^\d{1,20}$/.test(apiKey) || !apiSecret || !apiUser || !accountPassword)
      throw new AppError('Sedo requires a Partner ID, sign key, username and password.');
    return new URLSearchParams({
      partnerid: apiKey, signkey: apiSecret, username: apiUser, password: accountPassword,
      output_method: 'xml', ...extra,
    });
  }
  async function list(start: number, limit: number, name?: string) {
    const xml = await http.getText('/DomainList', form({
      startfrom: String(start), results: String(limit), orderby: '0',
      ...(name ? { 'domain[0]': name } : {}),
    }));
    return z.array(domainRow).max(limit).parse(readRows(xml, 'SEDODOMAINLIST'));
  }
  async function find(name: string) {
    const [row] = await list(0, 1, name);
    if (row && normalizeDomain(row.domain).name !== name)
      throw new AppError('Sedo returned a different domain.', 502);
    return row;
  }
  async function save(method: 'DomainInsert' | 'DomainEdit', name: string, values: Omit<DomainRow, 'domain'>) {
    const { category, domainlanguage, forsale, fixedprice, price, minprice, currency } = values;
    const params = form({
      'domainentry[0][domain]': name,
      'domainentry[0][forsale]': forsale,
      'domainentry[0][fixedprice]': fixedprice,
      'domainentry[0][price]': price,
      'domainentry[0][minprice]': minprice,
      'domainentry[0][currency]': currency,
    });
    if (domainlanguage) params.set('domainentry[0][domainlanguage]', domainlanguage);
    Object.values(category ?? {}).filter((id) => /^[1-9]\d*$/.test(id)).forEach((id, index) => {
      params.set(`domainentry[0][category][${index}]`, id);
    });
    const xml = await http.mutateText('POST', `/${method}`, undefined, params);
    const [result] = z.array(mutationRow).length(1).parse(readRows(xml, 'SEDOLIST'));
    if (normalizeDomain(result.domain).name !== name || result.status.toLowerCase() !== 'ok')
      throw new AppError('Sedo did not confirm the requested listing change.', 502);
  }
  return {
    async test() { await list(0, 1); },
    async *pages() {
      const seen = new Set<string>();
      for (let offset = 0; offset < 1_000_000; offset += 100) {
        const rows = (await list(offset, 100)).map(normalize);
        for (const row of rows) {
          if (seen.has(row.name)) throw new AppError('Sedo repeated a domain during synchronization.', 502);
          seen.add(row.name);
        }
        const listed = rows.filter((row) => row.status === 'listed');
        if (listed.length) yield listed;
        if (rows.length < 100) return;
      }
      throw new AppError('Sedo pagination did not complete.', 502);
    },
    async listing(name: string) {
      const row = await find(name);
      if (!row || row.forsale !== '1') return null;
      const listing = normalize(row);
      return { name, price: listing.binPrice ?? null, currency: currencies[row.currency], status: 'listed' };
    },
    async add(name: string, price: string) {
      const row = await find(name);
      if (row?.forsale === '1') throw new AppError('This domain already has an active Sedo listing.', 409);
      await save(row ? 'DomainEdit' : 'DomainInsert', name, {
        category: row?.category, domainlanguage: row?.domainlanguage || 'en',
        forsale: '1', price, minprice: row?.currency === '1' ? row.minprice : '0',
        fixedprice: '1', currency: '1',
      });
    },
    async update(name: string, price: string, currency: string) {
      const row = await find(name);
      if (!row || row.forsale !== '1' || currencies[row.currency] !== currency)
        throw new AppError('The Sedo listing or its currency changed. Sync and preview again.', 409);
      await save('DomainEdit', name, { ...row, price, fixedprice: '1' });
    },
    async remove(name: string) {
      const row = await find(name);
      if (!row || row.forsale !== '1') return;
      await save('DomainEdit', name, { ...row, forsale: '0' });
    },
  };
}

export function sedoAdapter(credentials: Credentials): Adapter {
  return sedoClient(credentials);
}
