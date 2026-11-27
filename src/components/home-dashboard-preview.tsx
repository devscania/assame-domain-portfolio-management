'use client';

import { useState } from 'react';
import { aggregateFinancialTrends, type TrendPeriod } from '@/lib/financial-trends';
import { FinancialPerformance } from './financial-performance';
import {
  ArrowUpRight,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  Globe2,
  Layers3,
  LayoutDashboard,
  Link2,
  RefreshCw,
  TrendingUp,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import { Distribution } from './charts';
import { formatMoney } from './client';
import {
  publicOverviewExample as data,
  publicOverviewAsOf,
  publicOverviewFinancialEvents,
} from '@/lib/public-overview-example';

export function HomeDashboardPreview() {
  const [period, setPeriod] = useState<TrendPeriod>('180d');
  const trend = aggregateFinancialTrends(publicOverviewFinancialEvents, {
    period,
    currency: data.currency,
    now: new Date(publicOverviewAsOf),
  });
  const kpis = [
    {
      label: 'Total domains',
      value: data.total.toLocaleString('en-US'),
      note: 'Across your entire workspace',
      icon: Globe2,
    },
    {
      label: 'Total listed BIN value',
      value: formatMoney(data.listingValue),
      note: `${data.listedBinDomainCount} domains · lowest listed BIN per domain`,
      icon: Layers3,
    },
    {
      label: 'Total portfolio investment',
      value: formatMoney(data.totalInvestment),
      note: 'Recorded acquisitions and holding costs',
      icon: Wallet,
    },
    {
      label:
        Number(data.netReturn) > 0
          ? 'Net portfolio profit'
          : Number(data.netReturn) < 0
            ? 'Net portfolio loss'
            : 'Net portfolio return',
      value: formatMoney(data.netReturn),
      note: `${formatMoney(data.collected)} collected less investment`,
      icon: TrendingUp,
    },
  ];
  return (
    <figure
      className="home-dashboard-preview"
      aria-label="Assame portfolio overview with illustrative records"
    >
      <div className="home-dashboard-top">
        <span>
          <Layers3 size={17} aria-hidden="true" /> Assame
        </span>
        <span>
          Horizon Portfolio <ChevronRight size={12} aria-hidden="true" />
        </span>
        <span className="home-dashboard-avatar" aria-hidden="true">
          A
        </span>
      </div>
      <div className="home-dashboard-body">
        <aside className="home-dashboard-nav" aria-label="Preview navigation">
          <span>WORKSPACE</span>
          {(
            [
              [LayoutDashboard, 'Overview'],
              [Globe2, 'My domains'],
              [Layers3, 'Marketplace listings'],
              [CalendarClock, 'Renewals'],
              [ChartNoAxesCombined, 'Analytics'],
              [Link2, 'Integrations'],
            ] as const
          ).map(([Icon, label]) => (
            <span key={String(label)} className={label === 'Overview' ? 'is-current' : ''}>
              {typeof Icon !== 'string' && <Icon size={13} aria-hidden="true" />}
              {String(label)}
            </span>
          ))}
        </aside>
        <div className="home-dashboard-content">
          <div className="home-dashboard-heading">
            <div>
              <span>YOUR WORKSPACE</span>
              <h2>Portfolio overview</h2>
              <p>A little perspective on everything you own.</p>
            </div>
            <ArrowUpRight size={18} aria-hidden="true" />
          </div>
          <div className="home-dashboard-context">
            <span>
              <i /> Portfolio snapshot
            </span>
            <span>
              <RefreshCw size={10} aria-hidden="true" /> Sync all
            </span>
          </div>
          <div className="home-dashboard-kpis">
            {kpis.map(({ label, value, note, icon: Icon }) => (
              <div key={label}>
                <span>
                  {label}
                  <Icon size={13} aria-hidden="true" />
                </span>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <div className="home-dashboard-attention">
            <span>
              <CalendarClock size={12} aria-hidden="true" />
              <strong>{data.expiring} domains</strong> expiring in 30 days
            </span>
            <span>
              <AlertTriangle size={12} aria-hidden="true" />
              <strong>{data.conflicts} price mismatches</strong> to review
            </span>
            <span>
              <CircleDollarSign size={12} aria-hidden="true" />
              <strong>{formatMoney(data.renewalForecast)}</strong> annual renewals
            </span>
          </div>
          <div className="home-dashboard-charts">
            <FinancialPerformance
              trend={trend}
              period={period}
              onPeriodChange={setPeriod}
              synthetic
              className="home-dashboard-performance"
            />
            <section className="home-dashboard-distribution">
              <div className="home-dashboard-card-title">
                <div>
                  <h3>A world of extensions</h3>
                  <p>Leading extensions</p>
                </div>
              </div>
              <Distribution
                total={data.total}
                data={data.tlds.map((t) => ({ label: `.${t.tld}`, value: t._count }))}
              />
              <noscript>
                <p>{data.tlds.map((t) => `.${t.tld}: ${t._count}`).join(' · ')}</p>
              </noscript>
            </section>
          </div>
        </div>
      </div>
      <figcaption>Product preview · illustrative records · USD · 10 Nov 2026</figcaption>
    </figure>
  );
}
