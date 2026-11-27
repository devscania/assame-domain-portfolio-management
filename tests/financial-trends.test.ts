import { describe, expect, it } from 'vitest';
import {
  aggregateFinancialTrends,
  financialTrendBounds,
  trendChange,
  parseTrendPeriod,
  type FinancialTrendEvent,
} from '../src/lib/financial-trends';
const now = new Date('2026-11-02T00:30:00-05:00');
describe('dated cash flow comparisons', () => {
  it('compares calendar YTD with the previous calendar YTD and clamps leap day explicitly', () => {
    const leap = financialTrendBounds('ytd', new Date('2024-02-29T12:34:56Z'));
    expect(leap.start).toBe('2024-01-01T00:00:00.000Z');
    expect(leap.previousStart).toBe('2023-01-01T00:00:00.000Z');
    expect(leap.previousEnd).toBe('2023-02-28T12:34:56.000Z');
    expect(leap.comparisonLabel).toBe('vs previous year to date');
    const result = aggregateFinancialTrends(
      [
        { kind: 'collected', amount: '10', currency: 'USD', at: '2023-02-01T00:00:00Z' },
        { kind: 'collected', amount: '999', currency: 'USD', at: '2023-12-01T00:00:00Z' },
        { kind: 'collected', amount: '20', currency: 'USD', at: '2024-02-01T00:00:00Z' },
      ],
      { period: 'ytd', currency: 'USD', now: new Date('2024-02-29T12:34:56Z') },
    );
    expect(result.metrics.collected).toMatchObject({ current: '20.00', previous: '10.00' });
  });
  it('uses an equal prior rolling year and bounded actual-history all-time buckets without a fake prior percentage', () => {
    const year = financialTrendBounds('365d', now);
    expect(Date.parse(year.end) - Date.parse(year.start)).toBe(365 * 86400000);
    expect(Date.parse(year.previousEnd) - Date.parse(year.previousStart)).toBe(365 * 86400000);
    const result = aggregateFinancialTrends(
      [
        { kind: 'acquisition', amount: '100', currency: 'USD', at: '2000-01-01T00:00:00Z' },
        { kind: 'collected', amount: '200', currency: 'USD', at: '2026-11-01T00:00:00Z' },
      ],
      { period: 'all', currency: 'USD', now },
    );
    expect(result.start).toBe('2000-01-01T00:00:00.000Z');
    expect(result.series.length).toBeLessThanOrEqual(120);
    expect(result.metrics.netCash).toMatchObject({
      current: '100.00',
      previous: null,
      change: { percent: null, label: 'No comparison period' },
    });
  });
  it('uses equal fixed UTC windows through DST and strict current/prior boundaries', () => {
    const bounds = financialTrendBounds('7d', now);
    expect(bounds.end).toBe('2026-11-02T05:30:00.000Z');
    expect(bounds.start).toBe('2026-10-26T05:30:00.000Z');
    expect(bounds.previousEnd).toBe(bounds.start);
    const events: FinancialTrendEvent[] = [
      { kind: 'collected', amount: '10', currency: 'USD', at: bounds.start },
      { kind: 'collected', amount: '20', currency: 'USD', at: bounds.previousStart },
      { kind: 'collected', amount: '999', currency: 'USD', at: bounds.end },
      {
        kind: 'collected',
        amount: '999',
        currency: 'USD',
        at: new Date(Date.parse(bounds.previousStart) - 1).toISOString(),
      },
    ];
    const trend = aggregateFinancialTrends(events, { period: '7d', currency: 'USD', now });
    expect(trend.metrics.collected).toMatchObject({
      current: '10.00',
      previous: '20.00',
      change: { percent: '-50.0', direction: 'down' },
    });
    expect(financialTrendBounds('90d', now).days).toBe(90);
    expect(parseTrendPeriod('unknown')).toBe('180d');
    const sixMonths = financialTrendBounds('180d', now);
    expect(Date.parse(sixMonths.end) - Date.parse(sixMonths.start)).toBe(180 * 86400000);
    expect(Date.parse(sixMonths.previousEnd) - Date.parse(sixMonths.previousStart)).toBe(
      180 * 86400000,
    );
  });
  it('changes real dated chart buckets with the chosen daily, weekly and 30-day intervals', () => {
    for (const [period, count] of [
      ['7d', 7],
      ['14d', 14],
      ['30d', 30],
      ['90d', 13],
      ['180d', 6],
    ] as const) {
      const start = financialTrendBounds(period, now).start;
      const trend = aggregateFinancialTrends(
        [
          { kind: 'collected', amount: '10', currency: 'USD', at: start },
          { kind: 'expenses', amount: '3', currency: 'USD', at: start },
        ],
        { period, currency: 'USD', now },
      );
      expect(trend.series).toHaveLength(count);
      expect(trend.series[0]).toMatchObject({
        collected: '10.00',
        spending: '3.00',
        netCash: '7.00',
      });
      expect(
        trend.series
          .slice(1)
          .every((item) => item.collected === '0.00' && item.spending === '0.00'),
      ).toBe(true);
      expect(trend.series.at(-1)?.end).toBe(now.toISOString());
    }
  });
  it('measures improvement against an absolute negative baseline', () => {
    expect(trendChange('-50', '-100')).toMatchObject({ percent: '50.0', direction: 'up' });
    expect(trendChange('-100', '-50')).toMatchObject({ percent: '-100.0', direction: 'down' });
    expect(trendChange('50', '-50')).toMatchObject({ percent: '200.0', direction: 'up' });
  });
  it('does not invent a percentage for zero, unavailable or offsetting-flow baselines', () => {
    expect(trendChange('20', '0')).toMatchObject({ percent: null, label: 'No prior activity' });
    expect(trendChange('0', '0')).toMatchObject({ percent: null, direction: 'flat' });
    expect(trendChange(null, '20')).toMatchObject({ percent: null, direction: 'unavailable' });
    const previous = financialTrendBounds('7d', now).previousStart;
    const trend = aggregateFinancialTrends(
      [
        { kind: 'collected', amount: '100', currency: 'USD', at: previous },
        { kind: 'expenses', amount: '100', currency: 'USD', at: previous },
      ],
      { period: '7d', currency: 'USD', now },
    );
    expect(trend.metrics.netCash.change).toMatchObject({
      percent: null,
      label: 'No percentage baseline',
    });
  });
  it('preserves exact currency arithmetic and treats unknown dates as unavailable instead of zero', () => {
    const at = financialTrendBounds('7d', now).start;
    const trend = aggregateFinancialTrends(
      [
        { kind: 'collected', amount: '0.10', currency: 'USD', at },
        { kind: 'collected', amount: '0.20', currency: 'USD', at },
        { kind: 'collected', amount: '999', currency: 'EUR', at: null },
        { kind: 'acquisition', amount: '0', currency: 'USD', at: null },
        { kind: 'expenses', amount: '0.05', currency: 'USD', at },
      ],
      { period: '7d', currency: 'USD', now },
    );
    expect(trend.metrics.netCash.current).toBe('0.25');
    expect(trend.undated.collected).toBe(0);
    const unknown = aggregateFinancialTrends(
      [{ kind: 'acquisition', amount: '20', currency: 'USD', at: null }],
      { period: '7d', currency: 'USD', now },
    );
    expect(unknown.metrics.netCash.current).toBeNull();
    expect(unknown.metrics.netCash.change.direction).toBe('unavailable');
    expect(unknown.metrics.collected.current).toBe('0.00');
  });
});
