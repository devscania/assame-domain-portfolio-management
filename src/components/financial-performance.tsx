'use client';
import { PerformanceChart } from './charts';
import { TrendIndicator } from './trend-indicator';
import { formatMoney } from './client';
import { Badge } from './ui';
import { trendPeriodOptions, type FinancialTrend, type TrendPeriod } from '@/lib/financial-trends';

export function FinancialPerformance({
  trend,
  period,
  onPeriodChange,
  loading = false,
  error = false,
  synthetic = false,
  className = '',
}: {
  trend: FinancialTrend | undefined;
  period: TrendPeriod;
  onPeriodChange: (period: TrendPeriod) => void;
  loading?: boolean;
  error?: boolean;
  synthetic?: boolean;
  className?: string;
}) {
  const netCash = trend?.metrics.netCash;
  const collected = trend?.metrics.collected.current;
  const spending = trend?.metrics.spending.current;
  const amount = (value: string) => formatMoney(value, trend?.currency);
  return (
    <section className={`card performance-card financial-performance ${className}`}>
      <div className="card-header financial-performance-heading">
        <div>
          <h3>Portfolio performance</h3>
          <p>Dated cash received and recorded spending</p>
        </div>
        <label className="trend-period-selector">
          <span>Chart period</span>
          <select
            aria-label="Portfolio performance period"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as TrendPeriod)}
          >
            {trendPeriodOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="financial-chart-state" role="status">
          Loading financial comparison…
        </div>
      ) : error || !trend ? (
        <div className="financial-chart-state" role="status">
          Financial comparison unavailable. Try another period or reload.
        </div>
      ) : (
        <>
          {(netCash?.current != null || collected != null || spending != null) && (
            <div className="financial-chart-summary" aria-live="polite">
              {netCash?.current != null && (
                <div className="financial-chart-net">
                  <span>Net dated cash flow · {trend.label}</span>
                  <strong>{amount(netCash.current)}</strong>
                  {netCash.change.direction !== 'unavailable' && (
                    <TrendIndicator
                      change={netCash.change}
                      label={`${trend.comparisonLabel}${netCash.previous === null ? '' : ` (${amount(netCash.previous)})`}`}
                    />
                  )}
                </div>
              )}
              {(collected != null || spending != null) && (
                <div className="financial-chart-totals">
                  {collected != null && (
                    <div>
                      <span>
                        <i className="legend-dot" />
                        Cash received
                      </span>
                      <strong>{amount(collected)}</strong>
                    </div>
                  )}
                  {spending != null && (
                    <div>
                      <span>
                        <i className="legend-dot legend-muted" />
                        Recorded spending
                      </span>
                      <strong>{amount(spending)}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <PerformanceChart
            data={trend.series.map((item) => ({
              month: item.label,
              collected: item.collected,
              acquisition: item.spending,
            }))}
            currency={trend.currency}
            spendingLabel="Dated spending"
          />
          <div className="financial-chart-range">
            <Badge>{synthetic ? 'Illustrative records' : 'Recorded events'}</Badge>
            <span>
              {trend.start.slice(0, 10)} – {trend.end.slice(0, 10)} UTC ·{' '}
              {trend.intervalDays === 1 ? 'daily' : `${trend.intervalDays}-day`} intervals ·{' '}
              {trend.currency}
            </span>
          </div>
          <noscript>
            <table>
              <caption>Dated cash received and recorded spending</caption>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Dated cash received</th>
                  <th>Dated spending</th>
                  <th>Net of dated records</th>
                </tr>
              </thead>
              <tbody>
                {trend.series.map((item) => (
                  <tr key={item.start}>
                    <td>{item.label}</td>
                    <td>{amount(item.collected)}</td>
                    <td>{amount(item.spending)}</td>
                    <td>{amount(item.netCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </noscript>
        </>
      )}
      <div className="chart-footnote">
        Cash received less dated acquisitions and recorded expenses. Renewal estimates are excluded.
        No currency conversion.
        {period === 'ytd' &&
          ' YTD compares the same UTC calendar date and time last year; February 29 is clamped to February 28.'}
        {period === 'all' && ' All time has no prior-period percentage.'}
      </div>
    </section>
  );
}
