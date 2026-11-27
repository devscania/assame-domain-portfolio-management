import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { ProviderHttp } from './http';
import type { Adapter, Credentials, RemoteDomain } from './adapters';

export const namecheapCredentials = z.object({
  apiKey: z.string().trim().min(3).max(50),
  apiUser: z.string().trim().min(1).max(50),
  clientIp: z.ipv4().optional().default('41.237.148.150'),
});
const command = 'namecheap.domains.getList';
const responseCommand = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.literal(command.toLowerCase()));
const row = z.object({
  '@_Name': z.string().min(1),
  '@_Created': z.string().optional(),
  '@_Expires': z.string().optional(),
  '@_AutoRenew': z
    .string()
    .regex(/^(true|false)$/i)
    .optional(),
});
const responseSchema = z.object({
  '@_Type': responseCommand,
  DomainGetListResult: z.union([z.literal(''), z.object({ Domain: z.array(row).default([]) })]),
  Paging: z.object({
    TotalItems: z.coerce.number().int().nonnegative(),
    CurrentPage: z.coerce.number().int().positive(),
    PageSize: z.coerce.number().int().min(1).max(100),
  }),
});

function date(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Namecheap supplies calendar dates as MM/DD/YYYY, not local-time instants.
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (match) {
    const [, month, day, year] = match.map(Number);
    const result = new Date(Date.UTC(year, month - 1, day));
    if (
      result.getUTCMonth() === month - 1 &&
      result.getUTCDate() === day &&
      result.getUTCFullYear() === year
    )
      return result.toISOString();
  }
  throw new AppError(
    'Namecheap returned an unsupported registration date; no date was guessed.',
    502,
  );
}

export function namecheapPage(xml: string, expectedPage: number) {
  if (
    xml.length > 2_000_000 ||
    /<!\s*(DOCTYPE|ENTITY)/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new AppError('Namecheap returned invalid or unsafe XML.', 502);
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    isArray: (name) => name === 'Domain' || name === 'Error',
  });
  let root;
  try {
    root = parser.parse(xml)?.ApiResponse;
  } catch {
    throw new AppError('Namecheap returned invalid XML.', 502);
  }
  if (!root || root['@_Status'] !== 'OK' || root.Errors?.Error?.length) {
    // Never surface raw provider error text: Namecheap may echo keys or query params.
    const rawCode = root?.Errors?.Error?.[0]?.['@_Number'];
    const code = typeof rawCode === 'string' && /^\d{1,10}$/.test(rawCode) ? rawCode : undefined;
    let hint = '';
    if (code === '1011150' || code === '1011151') {
      hint = ' (IP not whitelisted in Namecheap Profile > Tools > API Access > Whitelisted IPs)';
    } else if (code === '1011159' || code === '1011160') {
      hint = ' (API not enabled for this Namecheap account; requires 20+ domains or $50+ balance)';
    } else if (code === '1011153') {
      hint = ' (Invalid API key or username)';
    }
    throw new AppError(
      `Namecheap did not authorize inventory access${code ? ` (code ${code}${hint})` : ''}. Check API access, username, API key and the worker's allowlisted IPv4 address.`,
      403,
    );
  }
  const parsed = responseSchema.safeParse(root.CommandResponse);
  if (!parsed.success || !responseCommand.safeParse(root.RequestedCommand).success)
    throw new AppError(
      'Namecheap returned an unrecognized inventory response; synchronization was not confirmed.',
      502,
    );
  const data = parsed.data;
  const rows = typeof data.DomainGetListResult === 'string' ? [] : data.DomainGetListResult.Domain;
  const { TotalItems: total, CurrentPage: page, PageSize: size } = data.Paging;
  if (
    page !== expectedPage ||
    rows.length !== Math.min(size, Math.max(0, total - (page - 1) * size))
  )
    throw new AppError(
      'Namecheap returned incomplete or repeated pagination. Retry synchronization.',
      502,
    );
  return {
    total,
    size,
    rows: rows.map((item): RemoteDomain => ({
      name: item['@_Name'],
      registrar: 'Namecheap',
      registeredAt: date(item['@_Created']),
      expiresAt: date(item['@_Expires']),
      autoRenew:
        item['@_AutoRenew'] === undefined
          ? undefined
          : item['@_AutoRenew'].toLowerCase() === 'true',
    })),
  };
}

export async function namecheapBudget(apiKey: string) {
  // All connections using this key share persisted limits, including retries/tests.
  // Leave headroom under Namecheap's 50/min, 700/hour and 8000/day limits.
  const identity = createHash('sha256').update(apiKey).digest('hex');
  for (const [period, seconds, limit] of [
    ['minute', 60, 45],
    ['hour', 3600, 650],
    ['day', 86400, 7500],
  ] as const)
    await throttle(`namecheap:${identity}:${period}`, limit, seconds);
}

export function namecheapAdapter(credential: Credentials, client?: ProviderHttp): Adapter {
  const input = namecheapCredentials.safeParse(credential);
  if (!input.success)
    throw new AppError(
      'Namecheap requires an API key, account username and allowlisted IPv4 address.',
    );
  const credentials = input.data;
  const http =
    client ??
    new ProviderHttp('https://api.namecheap.com', {}, 6000, undefined, undefined, () =>
      namecheapBudget(credentials.apiKey),
    );
  async function read(page: number, size: number) {
    const query = new URLSearchParams({
      ApiUser: credentials.apiUser,
      ApiKey: credentials.apiKey,
      UserName: credentials.apiUser,
      ClientIp: credentials.clientIp,
      Command: command,
      ListType: 'ALL',
      SortBy: 'NAME',
      Page: String(page),
      PageSize: String(size),
    });
    return namecheapPage(await http.getText(`/xml.response?${query}`), page);
  }
  return {
    async test() {
      await read(1, 10);
    },
    async *pages() {
      const seen = new Set<string>();
      let total: number | undefined;
      let size: number | undefined;
      for (let page = 1; ; page++) {
        const result = await read(page, 100);
        if (
          (total !== undefined && result.total !== total) ||
          (size !== undefined && result.size !== size)
        )
          throw new AppError(
            'Namecheap inventory changed during pagination. Retry synchronization.',
            502,
          );
        total = result.total;
        size = result.size;
        for (const item of result.rows) {
          const name = item.name.toLowerCase();
          if (seen.has(name))
            throw new AppError(
              'Namecheap repeated a domain during pagination. Retry synchronization.',
              502,
            );
          seen.add(name);
        }
        yield result.rows;
        if (seen.size >= total) break;
      }
    },
  };
}
