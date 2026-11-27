'use client';

import { useQuery } from '@tanstack/react-query';
import { ChartNoAxesCombined, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { formatMoney, read } from './client';

type Report = {
  currency: string;
  months: {
    month: string;
    agreements: string;
    agreementCount: number;
    received: string;
    paymentCount: number;
  }[];
  undated: { amount: string; count: number };
};

export function AdvancedFinancialReport() {
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ['advanced-financial-report'],
    queryFn: () => read<Report>('view=advancedReport'),
    retry: false,
  });
  return (
    <section className="card financial-report">
      <div className="card-header">
        <div>
          <h2>Financial activity by month</h2>
          <p>12 months · current workspace</p>
        </div>
      </div>
      {isPending ? (
        <div className="report-loading" role="status">
          <span className="skeleton" />
          Loading your financial report…
        </div>
      ) : error ? (
        <div className="report-state">
          <span className="report-state-icon">
            <ChartNoAxesCombined size={22} />
          </span>
          <div>
            <h3>Your report could not be loaded</h3>
            <p>{(error as Error).message}</p>
          </div>
          <Button onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={15} /> Try again
          </Button>
        </div>
      ) : data ? (
        <div className="report-body">
          <p className="muted text-sm mb-4">
            {data.currency} only, without conversion. Agreements use the recorded sale date;
            receipts use the actual payment date. Agreements are not cash received.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month (UTC)</th>
                  <th>Agreements</th>
                  <th>Agreement value</th>
                  <th>Payments</th>
                  <th>Cash received</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((item) => (
                  <tr key={item.month}>
                    <td>{item.month}</td>
                    <td>{item.agreementCount}</td>
                    <td>{formatMoney(item.agreements, data.currency)}</td>
                    <td>{item.paymentCount}</td>
                    <td>{formatMoney(item.received, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.undated.count > 0 && (
            <p className="muted text-sm mt-4">
              {data.undated.count} payment(s) totaling{' '}
              {formatMoney(data.undated.amount, data.currency)} have no receipt date and are
              excluded from the monthly totals.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
