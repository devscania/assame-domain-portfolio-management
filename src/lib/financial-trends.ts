import Decimal from 'decimal.js';

export const trendPeriodOptions = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '14d', label: '14 days', days: 14 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '3 months (90 days)', days: 90 },
  { id: '180d', label: '6 months (180 days)', days: 180 },
  { id: '365d', label: '1 year (365 days)', days: 365 },
  { id: 'ytd', label: 'Year to date', days: 0 },
  { id: 'all', label: 'All time', days: 0 },
] as const;
export type TrendPeriod = (typeof trendPeriodOptions)[number]['id'];
export type TrendChange = {
  direction: 'up' | 'down' | 'flat' | 'unavailable';
  percent: string | null;
  label: string;
};
export type FinancialTotals = { collected: string; acquisition: string; expenses: string };
export type FinancialCoverage = { collected: number; acquisition: number; expenses: number };
export type FinancialTrendEvent = {
  kind: keyof FinancialTotals;
  amount: string;
  currency: string;
  at: string | null;
};
export function parseTrendPeriod(value: string | null): TrendPeriod {
  return trendPeriodOptions.find((item) => item.id === value)?.id ?? '180d';
}
/** Equal trailing periods measured in UTC instants; no local-time/DST arithmetic. */
export function financialTrendBounds(period: TrendPeriod, now = new Date(), earliestDate?: Date) {
  const option = trendPeriodOptions.find((item) => item.id === period)!;
  const duration = option.days * 86400000;
  const end = now.toISOString();
  const start = (
    period === 'ytd'
      ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      : period === 'all'
        ? earliestDate && earliestDate < now
          ? earliestDate
          : now
        : new Date(now.getTime() - duration)
  ).toISOString();
  const days = (now.getTime() - Date.parse(start)) / 86400000;
  const priorYear = now.getUTCFullYear() - 1;
  const priorDay = Math.min(
    now.getUTCDate(),
    new Date(Date.UTC(priorYear, now.getUTCMonth() + 1, 0)).getUTCDate(),
  );
  const previousStart =
    period === 'ytd'
      ? new Date(Date.UTC(priorYear, 0, 1)).toISOString()
      : period === 'all'
        ? start
        : new Date(now.getTime() - 2 * duration).toISOString();
  const previousEnd =
    period === 'ytd'
      ? new Date(
          Date.UTC(
            priorYear,
            now.getUTCMonth(),
            priorDay,
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
            now.getUTCMilliseconds(),
          ),
        ).toISOString()
      : start;
  return {
    period,
    label: option.label,
    days,
    intervalDays:
      period === 'all'
        ? Math.max(1, Math.ceil(days / 120))
        : period === '180d' || period === '365d'
          ? 30
          : period === '90d' || (period === 'ytd' && days > 30)
            ? 7
            : 1,
    comparisonLabel:
      period === 'all'
        ? 'All recorded activity'
        : period === 'ytd'
          ? 'vs previous year to date'
          : `vs previous ${option.days} days`,
    comparisonApplicable: period !== 'all',
    start,
    end,
    previousStart,
    previousEnd,
  };
}
export function financialTrendBuckets(period: TrendPeriod, now = new Date(), earliestDate?: Date) {
  const bounds = financialTrendBounds(period, now, earliestDate);
  const duration = bounds.intervalDays * 86400000;
  return Array.from(
    { length: Math.max(1, Math.ceil(bounds.days / bounds.intervalDays)) },
    (_, index) => {
      const start = new Date(Date.parse(bounds.start) + index * duration);
      return {
        start: start.toISOString(),
        end: new Date(Math.min(start.getTime() + duration, now.getTime())).toISOString(),
        label: new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(start),
        collected: '0.00',
        spending: '0.00',
        netCash: '0.00',
      };
    },
  );
}
export type FinancialTrendBucket = ReturnType<typeof financialTrendBuckets>[number];
export function trendChange(
  current: string | null,
  previous: string | null,
  priorActivity = false,
): TrendChange {
  if (current === null || previous === null)
    return { direction: 'unavailable', percent: null, label: 'Trend unavailable' };
  const difference = new Decimal(current).minus(previous);
  const direction = difference.gt(0) ? 'up' : difference.lt(0) ? 'down' : 'flat';
  if (new Decimal(previous).isZero())
    return {
      direction,
      percent: null,
      label: priorActivity ? 'No percentage baseline' : 'No prior activity',
    };
  const percent = difference.div(new Decimal(previous).abs()).mul(100);
  const rounded = percent.toDecimalPlaces(1);
  return {
    direction,
    percent: rounded.toFixed(1),
    label:
      !difference.isZero() && rounded.isZero()
        ? '<0.1% change'
        : `${rounded.gt(0) ? '+' : ''}${rounded.toFixed(1)}%`,
  };
}
export function financialTrendSnapshot({
  period,
  currency,
  now,
  current,
  previous,
  undated,
  series,
  earliestDate,
}: {
  period: TrendPeriod;
  currency: string;
  now: Date;
  current: FinancialTotals;
  previous: FinancialTotals;
  undated: FinancialCoverage;
  series?: FinancialTrendBucket[];
  earliestDate?: Date;
}) {
  const receiptUnknown = undated.collected > 0;
  const spendingUnknown = undated.acquisition > 0 || undated.expenses > 0;
  const metric = (current: string | null, previous: string | null, priorActivity = false) => ({
    current,
    previous,
    change:
      period === 'all' && current !== null
        ? { direction: 'flat' as const, percent: null, label: 'No comparison period' }
        : trendChange(current, previous, priorActivity),
  });
  const spending = (totals: FinancialTotals) =>
    new Decimal(totals.acquisition).plus(totals.expenses).toFixed(2);
  const net = (totals: FinancialTotals) =>
    new Decimal(totals.collected).minus(spending(totals)).toFixed(2);
  return {
    ...financialTrendBounds(period, now, earliestDate),
    currency,
    undated,
    series: (series ?? financialTrendBuckets(period, now, earliestDate)).map((item) => ({
      ...item,
      netCash: new Decimal(item.collected).minus(item.spending).toFixed(2),
    })),
    metrics: {
      collected: metric(
        receiptUnknown ? null : current.collected,
        receiptUnknown || period === 'all' ? null : previous.collected,
      ),
      spending: metric(
        spendingUnknown ? null : spending(current),
        spendingUnknown || period === 'all' ? null : spending(previous),
      ),
      netCash: metric(
        receiptUnknown || spendingUnknown ? null : net(current),
        receiptUnknown || spendingUnknown || period === 'all' ? null : net(previous),
        new Decimal(previous.collected)
          .abs()
          .plus(new Decimal(previous.acquisition).abs())
          .plus(new Decimal(previous.expenses).abs())
          .gt(0),
      ),
    },
  };
}
export type FinancialTrend = ReturnType<typeof financialTrendSnapshot>;
/** Shared by illustrative fixtures; the server aggregates persisted events in SQL. */
export function aggregateFinancialTrends(
  events: FinancialTrendEvent[],
  options: { period: TrendPeriod; currency: string; now: Date },
): FinancialTrend {
  const dated = events
    .filter((event) => event.currency === options.currency && !new Decimal(event.amount).isZero())
    .map((event) => (event.at ? Date.parse(event.at) : NaN))
    .filter((at) => Number.isFinite(at) && at < options.now.getTime());
  const earliestDate = dated.length ? new Date(Math.min(...dated)) : undefined;
  const bounds = financialTrendBounds(options.period, options.now, earliestDate);
  const current = { collected: '0.00', acquisition: '0.00', expenses: '0.00' };
  const previous = { ...current };
  const undated = { collected: 0, acquisition: 0, expenses: 0 };
  const series = financialTrendBuckets(options.period, options.now, earliestDate);
  for (const event of events) {
    if (event.currency !== options.currency || new Decimal(event.amount).isZero()) continue;
    const at = event.at ? new Date(event.at).getTime() : NaN;
    if (!Number.isFinite(at)) {
      undated[event.kind]++;
      continue;
    }
    const currentWindow = at >= Date.parse(bounds.start) && at < Date.parse(bounds.end);
    const previousWindow =
      at >= Date.parse(bounds.previousStart) && at < Date.parse(bounds.previousEnd);
    if (!currentWindow && !previousWindow) continue;
    const target = currentWindow ? current : previous;
    target[event.kind] = new Decimal(target[event.kind]).plus(event.amount).toFixed(2);
    if (target === current) {
      const index = Math.floor((at - Date.parse(bounds.start)) / (bounds.intervalDays * 86400000));
      const key = event.kind === 'collected' ? 'collected' : 'spending';
      series[index][key] = new Decimal(series[index][key]).plus(event.amount).toFixed(2);
    }
  }
  return financialTrendSnapshot({ ...options, current, previous, undated, series, earliestDate });
}
