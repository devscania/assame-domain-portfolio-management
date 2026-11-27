import { z } from 'zod';
import { AppError } from '@/lib/security';
import { ProviderHttp } from './http';
import type { Adapter, Credentials } from './adapters';

export function atomRegistrarAdapter(credentials: Credentials): Adapter {
  const http = new ProviderHttp(
    'https://www.atom.com/api',
    { Authorization: `Bearer ${credentials.apiKey}` },
    1500,
  );
  const schema = z.object({
    success: z.literal(true),
    data: z.array(
      z.object({
        domain_name: z.string(),
        expiry_date: z.string().optional(),
        created_date: z.string().optional(),
        nameservers: z.array(z.string()).optional(),
        auto_renew: z.boolean().optional(),
      }),
    ),
    pagination: z.object({
      current_page: z.number().int(),
      total_pages: z.number().int().nonnegative(),
    }),
  });
  function date(value: string | undefined) {
    if (!value) return undefined;
    const d = new Date(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value,
    );
    if (Number.isNaN(d.getTime()))
      throw new AppError('Atom Registrar returned an unsupported date', 502);
    return d.toISOString();
  }
  return {
    async test() {
      schema.parse(await http.get('/registrar/v1/domains?page=1&size=1'));
    },
    async *pages() {
      for (let page = 1; ; page++) {
        const result = schema.parse(await http.get(`/registrar/v1/domains?page=${page}&size=100`));
        if (
          result.pagination.current_page !== page ||
          (page < result.pagination.total_pages && !result.data.length)
        )
          throw new AppError('Atom Registrar pagination is incomplete', 502);
        yield result.data.map((d) => ({
          name: d.domain_name,
          registrar: 'Atom',
          expiresAt: date(d.expiry_date),
          registeredAt: date(d.created_date),
          autoRenew: d.auto_renew,
          nameservers: d.nameservers,
        }));
        if (page >= result.pagination.total_pages) break;
      }
    },
  };
}
