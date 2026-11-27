import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinancialPerformance } from '../src/components/financial-performance';
import { aggregateFinancialTrends, type FinancialTrendEvent } from '../src/lib/financial-trends';

function renderPerformance(events: FinancialTrendEvent[]) {
  const period = '180d';
  const trend = aggregateFinancialTrends(events, {
    period,
    currency: 'USD',
    now: new Date('2026-11-25T00:00:00Z'),
  });
  return renderToStaticMarkup(
    createElement(FinancialPerformance, { trend, period, onPeriodChange: () => {} }),
  );
}

describe('portfolio performance summary', () => {
  it('hides unavailable totals and comparisons while keeping valid totals and the dated plot', () => {
    const markup = renderPerformance([
      { kind: 'collected', amount: '200', currency: 'USD', at: '2026-11-01T00:00:00Z' },
      { kind: 'acquisition', amount: '50', currency: 'USD', at: null },
    ]);

    expect(markup).toContain('Cash received');
    expect(markup).toContain('$200');
    expect(markup).toContain('chart-container');
    expect(markup).not.toMatch(
      /unavailable|Recorded spending<\/span>|Net dated cash flow|vs previous/i,
    );
  });

  it('omits an empty summary when neither receipts nor spending can be totaled', () => {
    const markup = renderPerformance([
      { kind: 'collected', amount: '200', currency: 'USD', at: null },
      { kind: 'acquisition', amount: '50', currency: 'USD', at: null },
    ]);

    expect(markup).not.toContain('financial-chart-summary');
    expect(markup).toContain('No financial activity in this period');
  });

  it('shows totals including zero and the comparison when data is complete', () => {
    const markup = renderPerformance([
      { kind: 'collected', amount: '200', currency: 'USD', at: '2026-11-01T00:00:00Z' },
      { kind: 'collected', amount: '100', currency: 'USD', at: '2026-04-01T00:00:00Z' },
    ]);

    expect(markup).toContain('Net dated cash flow');
    expect(markup).toContain('+100.0%');
    expect(markup).toContain('vs previous 180 days ($100)');
    expect(markup).toContain('Recorded spending</span><strong>$0</strong>');
  });
});
