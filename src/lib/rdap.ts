import { isIP } from 'node:net';
import Papa from 'papaparse';
import { z } from 'zod';
import { normalizeDomain } from './domain';
import { normalizeNameservers } from './public-nameservers';

const bootstrapUrl = 'https://data.iana.org/rdap/dns.json';
const registrarIdsUrl = 'https://www.iana.org/assignments/registrar-ids/registrar-ids-1.csv';
const eventDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const services = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
});
const rdapDomain = z.object({
  objectClassName: z.literal('domain'),
  ldhName: z.string(),
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).default([]),
  nameservers: z.array(z.unknown()).default([]),
  entities: z
    .array(
      z.object({
        roles: z.array(z.string()).default([]),
        publicIDs: z.array(z.object({ type: z.string(), identifier: z.string() })).default([]),
        vcardArray: z.tuple([z.literal('vcard'), z.array(z.array(z.unknown()))]).optional(),
      }),
    )
    .default([]),
});

async function publicText(url: URL, accept: string) {
  const response = await fetch(url, {
    headers: { Accept: accept },
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > 1_000_000) return null;
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

let bootstrapCache: { until: number; value: Promise<Map<string, URL>> } | undefined;
function bootstrap() {
  if (!bootstrapCache || bootstrapCache.until < Date.now()) {
    const value = (async () => {
      const result = await publicText(new URL(bootstrapUrl), 'application/json');
      if (!result) throw new Error('RDAP directory unavailable');
      const map = new Map<string, URL>();
      for (const [suffixes, endpoints] of services.parse(JSON.parse(result)).services) {
        for (const endpoint of endpoints) {
          const url = URL.parse(endpoint);
          if (
            !url ||
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            url.search ||
            url.hash ||
            isIP(url.hostname) ||
            !url.hostname.includes('.')
          )
            continue;
          for (const suffix of suffixes) map.set(suffix.toLowerCase(), url);
          break;
        }
      }
      return map;
    })().catch((error) => {
      bootstrapCache = undefined;
      throw error;
    });
    bootstrapCache = { until: Date.now() + 86400000, value };
  }
  return bootstrapCache.value;
}

let registrarCache: { until: number; value: Promise<Map<string, string>> } | undefined;
function registrarNames() {
  if (!registrarCache || registrarCache.until < Date.now()) {
    const value = (async () => {
      const csv = await publicText(new URL(registrarIdsUrl), 'text/csv');
      if (!csv) throw new Error('IANA registrar names unavailable');
      return new Map(
        Papa.parse<{ ID: string; 'Registrar Name': string }>(csv, {
          header: true,
          skipEmptyLines: true,
        }).data.map((row) => [row.ID, row['Registrar Name']]),
      );
    })().catch((error) => {
      registrarCache = undefined;
      throw error;
    });
    registrarCache = { until: Date.now() + 86400000, value };
  }
  return registrarCache.value;
}

export async function lookupRegistration(name: string) {
  const domain = normalizeDomain(name).name;
  const directory = await bootstrap();
  const labels = domain.split('.');
  const endpoint = labels
    .slice(1)
    .map((_, i) => directory.get(labels.slice(i + 1).join('.')))
    .find(Boolean);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/?$/, '/') + 'domain/' + encodeURIComponent(domain);
  const json = await publicText(url, 'application/rdap+json, application/json');
  if (!json) return null;
  const result = rdapDomain.safeParse(JSON.parse(json));
  if (!result.success || normalizeDomain(result.data.ldhName).name !== domain) return null;
  const entities = result.data.entities.filter((entity) => entity.roles.includes('registrar'));
  const entity = entities.length === 1 ? entities[0] : undefined;
  const fn = entity?.vcardArray?.[1].find((property) => property[0] === 'fn')?.[3];
  const id = entity?.publicIDs.find((entry) => entry.type === 'IANA Registrar ID')?.identifier;
  const label =
    typeof fn === 'string'
      ? fn
      : id
        ? (await registrarNames().catch(() => new Map<string, string>())).get(id)
        : undefined;
  const registrar = label?.trim();
  const date = (action: string) => {
    const dates = [
      ...new Set(
        result.data.events
          .filter((event) => event.eventAction === action)
          .map((event) => eventDate.safeParse(event.eventDate))
          .filter((event) => event.success)
          .map((event) => new Date(event.data).toISOString()),
      ),
    ];
    return dates.length === 1 ? new Date(dates[0]) : undefined;
  };
  return {
    registrar:
      registrar && registrar.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(registrar)
        ? registrar
        : undefined,
    expiresAt: date('expiration'),
    registeredAt: date('registration'),
    nameservers: normalizeNameservers(
      result.data.nameservers.map((entry) => {
        const parsed = z
          .object({ ldhName: z.string().optional(), unicodeName: z.string().optional() })
          .safeParse(entry);
        return parsed.success ? parsed.data.ldhName || parsed.data.unicodeName : undefined;
      }),
    ),
  };
}
