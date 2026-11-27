import { expirationMonthWindow } from './expiration';
import { comparisonLabels } from './comparison-labels';
export type DomainTableQuery = {
  q: string;
  tld: string;
  status: string;
  registrar: string;
  tag: string;
  comparison: string;
  listing: string;
  attention: string;
  expiration: string;
  days: string;
  month: string;
  page: number;
  take: number;
  sort: string;
  direction: string;
};
export function domainTableQuery(
  query: Pick<URLSearchParams, 'get'>,
  matrix = false,
  renewals = false,
): DomainTableQuery {
  const comparison = query.get('comparison') || '';
  const days = Math.max(0, Math.min(365, Number(query.get('days')) || 0));
  return {
    q: (query.get('q') || '').slice(0, 253),
    tld: query.get('tld') || '',
    status: query.get('status') || (matrix || renewals ? 'active' : ''),
    registrar: query.get('registrar') || '',
    tag: query.get('tag') || '',
    comparison: Object.hasOwn(comparisonLabels, comparison) ? comparison : '',
    listing: query.get('listing') === 'none' ? 'none' : '',
    attention: query.get('attention') === 'price-mismatch' ? 'price-mismatch' : '',
    expiration: ['expired', 'upcoming'].includes(query.get('expiration') || '')
      ? query.get('expiration')!
      : '',
    days: days ? String(days) : '',
    month: expirationMonthWindow(query.get('month')) ? query.get('month')! : '',
    page: Math.max(1, Math.min(100000, Math.floor(Number(query.get('page')) || 1))),
    take: [25, 50, 100, 200, 500].includes(Number(query.get('take')))
      ? Number(query.get('take'))
      : 25,
    sort: [
      'name',
      'askingPrice',
      'acquisitionCost',
      'createdAt',
      'registrar',
      'nameservers',
      'status',
      'comparison',
      'expiration',
    ].includes(query.get('sort') || '')
      ? query.get('sort')!
      : matrix
        ? 'comparison'
        : renewals
          ? 'expiration'
          : 'name',
    direction:
      query.get('direction') === 'desc'
        ? 'desc'
        : query.get('direction') === 'asc'
          ? 'asc'
          : matrix
            ? 'desc'
            : 'asc',
  };
}
export function domainTableSearch(state: DomainTableQuery) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(state))
    if (value !== '' && !(key === 'page' && value === 1) && !(key === 'take' && value === 25))
      query.set(key, String(value));
  return query.toString();
}
