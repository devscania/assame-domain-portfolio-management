import type { Summary } from '@/components/client';
import type { FinancialTrendEvent } from './financial-trends';

const domainCount = 728;
const acquisitionCostPattern = [1298, 12500, 8900, 45000, 3200, 29900, 150000, 2199];
// The current inventory and its recorded acquisition history cover different scopes.
const acquisitionCents = Array.from(
  { length: 128 },
  (_, index) => acquisitionCostPattern[index % acquisitionCostPattern.length],
);
const receipts = [
  ['2026-04-14', 745000],
  ['2026-04-28', 750000],
  ['2026-05-06', 875000],
  ['2026-06-19', 620000],
  ['2026-06-28', 390000],
  ['2026-07-23', 540000],
  ['2026-07-29', 165000],
  ['2026-08-07', 665000],
  ['2026-08-25', 200000],
  ['2026-10-02', 790000],
  ['2026-10-22', 395000],
  ['2026-10-31', 300000],
  ['2026-11-07', 625000],
] as const;
const money = (cents: number) => (cents / 100).toFixed(2);
export const publicOverviewAsOf = '2026-11-10T12:00:00.000Z';

/** Illustrative inventory based on the seed and independent sample sales. */
function seededOverviewExample() {
  const firstExtensions = [
    'com',
    'studio',
    'io',
    'com',
    'ai',
    'co',
    'com',
    'io',
    'com',
    'ai',
    'co',
    'com',
    'gg',
    'gg',
    'io',
    'studio',
  ];
  const extensions = ['com', 'io', 'ai', 'co', 'com', 'com', 'studio'];
  const tlds = new Map<string, number>();
  let listingValue = 0,
    listedBinDomainCount = 0,
    listingCount = 0,
    renewalForecast = 0;
  for (let i = 0; i < domainCount; i++) {
    const tld = firstExtensions[i] ?? extensions[i % extensions.length];
    tlds.set(tld, (tlds.get(tld) ?? 0) + 1);
    renewalForecast += tld === 'ai' ? 7998 : tld === 'io' ? 3998 : 1298;
    if (i % 7 !== 0) {
      listingValue += (1499 + (i % 12) * 500) * 100;
      listedBinDomainCount++;
      for (const marketplace of ['afternic', 'atom', 'spaceship']) {
        if (marketplace === 'atom' && i % 3 !== 0) continue;
        if (marketplace === 'spaceship' && i % 4 === 0) continue;
        listingCount++;
      }
    }
  }
  const investment = acquisitionCents.reduce((sum, cents) => sum + cents, 0);
  const collected = receipts.reduce((sum, [, cents]) => sum + cents, 0);
  return {
    total: domainCount,
    listingCount,
    listedBinDomainCount,
    listingValue: money(listingValue),
    investment: money(investment),
    totalInvestment: money(investment),
    collected: money(collected),
    netReturn: money(collected - investment),
    renewalForecast: money(renewalForecast),
    expiring: 6,
    conflicts: 3,
    currency: 'USD',
    tlds: [...tlds]
      .map(([tld, count]) => ({ tld, _count: count }))
      .sort((a, b) => b._count - a._count),
  } satisfies Pick<
    Summary,
    | 'total'
    | 'listingCount'
    | 'listedBinDomainCount'
    | 'listingValue'
    | 'investment'
    | 'totalInvestment'
    | 'collected'
    | 'netReturn'
    | 'renewalForecast'
    | 'expiring'
    | 'conflicts'
    | 'currency'
    | 'tlds'
  >;
}
export const publicOverviewExample = seededOverviewExample();

/** Illustrative ledger events shared by all chart periods. */
export const publicOverviewFinancialEvents: FinancialTrendEvent[] = [
  ...acquisitionCents.map((cents, index): FinancialTrendEvent => {
    const acquired = new Date(publicOverviewAsOf);
    const monthOffset = index % acquisitionCostPattern.length;
    const availableDays = monthOffset ? 27 : acquired.getUTCDate() - 1;
    acquired.setUTCMonth(acquired.getUTCMonth() - monthOffset, 1 + (index % availableDays));
    return {
      at: acquired.toISOString(),
      kind: 'acquisition',
      amount: money(cents),
      currency: publicOverviewExample.currency,
    };
  }),
  ...receipts.map(([date, cents]): FinancialTrendEvent => ({
    at: `${date}T12:00:00.000Z`,
    kind: 'collected',
    amount: money(cents),
    currency: publicOverviewExample.currency,
  })),
];
