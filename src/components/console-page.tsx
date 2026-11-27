'use client';
import { useState, Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Download,
  Globe2,
  Layers3,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Badge, Empty, Skeleton } from './ui';
import { read, api, formatMoney, formatDate, type Summary } from './client';
import { useWorkspace } from './shell';
import { DomainForm, ImportWizard } from './domain-forms';
import { DomainTable } from './domain-table';
import { Distribution, PerformanceChart, GrowthChart, TrafficChart } from './charts';
import { Integrations, ActivityCenter, Settings } from './management';
import { DomainDetails, Sales } from './details-finance';
import { ProviderLogo } from './provider-logo';
import { providerIdForName as providerFromLabel } from '@/integrations/catalog';
import { MarketplaceAnalytics } from './marketplace-analytics';
import { AdvancedFinancialReport } from './advanced-financial-report';
import { PublicRegistrationLookup } from './public-registration-lookup';
import { FinancialPerformance } from './financial-performance';
import { domainTableQuery, domainTableSearch } from '@/lib/domain-table-query';
import { type TrendPeriod, type FinancialTrend } from '@/lib/financial-trends';
const titles: Record<string, [string, string]> = {
  overview: ['Portfolio overview', 'A little perspective on everything you own.'],
  domains: ['My domains', 'Your next great opportunity is already in your portfolio.'],
  listings: ['Marketplace listings', 'Every marketplace. Every price. One clear picture.'],
  registrars: ['Your registrars', 'Where your domains live, all in one place.'],
  sales: ['Sales & revenue', 'Follow the numbers, from agreement to cash collected.'],
  renewals: ['Stay ahead of renewals', 'Protect your best assets. Plan for what’s next.'],
  analytics: ['Portfolio insights', 'Understand the shape and performance of your portfolio.'],
  sync: ['Activity center', 'Review workspace changes, background jobs and provider connections.'],
  integrations: [
    'Connect your portfolio',
    'Bring your registrars and marketplaces into the same conversation.',
  ],
  settings: ['Settings', 'Manage your account and workspace preferences.'],
};

function RenewalReviewLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      prefetch={false}
      onNavigate={(event) => {
        const target = new URL(href, window.location.origin);
        const search = domainTableSearch(domainTableQuery(target.searchParams, false, true));
        const current = new URL(window.location.href);
        const currentSearch = domainTableSearch(
          domainTableQuery(current.searchParams, false, true),
        );
        event.preventDefault();
        if (
          target.pathname !== current.pathname ||
          search !== currentSearch ||
          target.hash !== current.hash
        ) {
          window.history.pushState(null, '', `${target.pathname}?${search}${target.hash}`);
        }
        const review = document.getElementById('renewal-review');
        review?.focus({ preventScroll: true });
        review?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }}
    >
      {children}
    </Link>
  );
}
export function ConsolePage({
  section,
  domainId,
  settingsTab,
  settingsAccountPanel,
}: {
  section: string;
  domainId?: string;
  settingsTab?: string;
  settingsAccountPanel?: ReactNode;
}) {
  const [add, setAdd] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const workspace = useWorkspace();
  const query = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['summary'],
    queryFn: () => read<Summary>('view=summary'),
    enabled: section !== 'settings',
    refetchInterval: section === 'sync' ? 10000 : false,
  });
  async function sync() {
    setSyncing(true);
    try {
      const result = await api<{ queued: number }>('sync.queue', {});
      toast[result.queued ? 'success' : 'info'](
        result.queued
          ? `${result.queued} read-only sync jobs queued`
          : 'Connect a provider to synchronize remote data',
      );
      await query.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  if (domainId)
    return (
      <div className="console-workspace console-detail">
        <DomainDetails id={domainId} />
      </div>
    );
  return (
    <div className={`console-workspace console-${section}`}>
      <div className="page-heading">
        <div>
          <div className="page-breadcrumb">
            WORKSPACE <span>/</span>{' '}
            {section === 'overview' ? 'OVERVIEW' : titles[section][0].toUpperCase()}
          </div>
          <h1>{titles[section][0]}</h1>
          <p>{titles[section][1]}</p>
        </div>
        <div className="heading-actions">
          {['domains', 'sync'].includes(section) && !workspace.demo && <PublicRegistrationLookup />}
          {['overview', 'domains'].includes(section) ? (
            <>
              <Button onClick={() => setImportOpen(true)}>
                <Upload size={16} />
                Import CSV
              </Button>
              <Button
                variant="primary"
                disabled={workspace.role === 'VIEWER'}
                onClick={() => setAdd(true)}
              >
                <Plus size={17} />
                Add domain
              </Button>
            </>
          ) : ['listings', 'renewals', 'sales', 'analytics'].includes(section) ? (
            <a
              className="btn btn-secondary"
              href={section === 'sales' ? '/api/finance-export' : '/api/export'}
            >
              <Download size={16} />
              {section === 'sales' ? 'Export finance' : 'Export portfolio'}
            </a>
          ) : section === 'sync' ? (
            <Button variant="primary" onClick={() => void sync()} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              Sync all providers
            </Button>
          ) : null}
        </div>
      </div>
      {section === 'settings' ? (
        <Settings activeTab={settingsTab} accountPanel={settingsAccountPanel} />
      ) : error ? (
        <Empty title="Your workspace needs attention" description={(error as Error).message}>
          <Button onClick={() => void query.invalidateQueries()}>Retry</Button>
        </Empty>
      ) : isPending || !data ? (
        <Skeleton />
      ) : (
        <>
          {section === 'overview' && (
            <Overview data={data} onSync={() => void sync()} syncing={syncing} />
          )}
          {section === 'domains' && (
            <>
              <Suspense>
                <DomainTable />
              </Suspense>
            </>
          )}
          {section === 'listings' && (
            <>
              <div className="notice mb-6">
                <ShieldCheck size={19} />
                <div>
                  <strong>Your marketplace prices stay independent.</strong>
                  <p>
                    Use a listing’s edit button to preview and confirm its provider-specific BIN
                    change. Internal asking prices never overwrite provider prices. Use the
                    comparison header or filter to find mismatches. Select domains to fetch Afternic
                    views/leads and Atom views/offers/shortlists. Spaceship and Dynadot listing
                    traffic is not exposed by the integrated APIs.
                  </p>
                </div>
              </div>
              <div className="summary-strip mb-6">
                <div>
                  <strong>{data.listingCount}</strong>
                  <span>active listing records</span>
                </div>
                <Link
                  href="/domains?attention=price-mismatch&status=all"
                  className="summary-action"
                >
                  <strong>{data.conflicts}</strong>
                  <span>
                    listing price differences <ArrowUpRight size={13} />
                  </span>
                </Link>
                <Link href="/domains?listing=none&status=active" className="summary-action">
                  <strong>{data.missing}</strong>
                  <span>
                    domains without listings <ArrowUpRight size={13} />
                  </span>
                </Link>
              </div>
              <Suspense>
                <DomainTable matrix />
              </Suspense>
            </>
          )}
          {section === 'registrars' && (
            <div className="provider-grid">
              {data.registrars.map((r) => (
                <div className="card registrar-card" key={r.registrar}>
                  <div className="registrar-logo">
                    {providerFromLabel(r.registrar) ? (
                      <ProviderLogo provider={providerFromLabel(r.registrar)!} size={48} />
                    ) : (
                      <Layers3 size={26} />
                    )}
                  </div>
                  <h3>{r.registrar}</h3>
                  <p>Registrar inventory</p>
                  <strong className="registrar-total">
                    {r._count.toLocaleString()}
                    <small>registration records</small>
                  </strong>
                  <Link
                    href={`/domains?registrar=${encodeURIComponent(r.registrar)}`}
                    className="text-link"
                  >
                    View registered domains
                    <ArrowRight size={16} />
                  </Link>
                </div>
              ))}
              {!data.registrars.length && (
                <Empty
                  title="Your inventory starts here"
                  description="Import registrar data or connect a supported provider."
                >
                  <Link href="/integrations" className="btn btn-primary">
                    Explore integrations <ArrowUpRight size={15} />
                  </Link>
                </Empty>
              )}
            </div>
          )}
          {section === 'renewals' && (
            <>
              <div className="renewal-planning">
                <section className="card renewal-forecast">
                  <div className="renewal-card-icon">
                    <CalendarClock size={22} />
                  </div>
                  <span className="section-eyebrow">NEXT 365 DAYS · KNOWN ESTIMATES</span>
                  <strong>{formatMoney(data.renewalForecast, data.currency)}</strong>
                  <p>
                    Recorded renewal costs for active domains. Unknown costs and other currencies
                    are excluded.
                  </p>
                  <span className="renewal-readonly">
                    <ShieldCheck size={14} /> Planning only · renew with your registrar
                  </span>
                </section>
                <section className="card renewal-priorities">
                  <span className="section-eyebrow">START WITH THE CLOSEST DATES</span>
                  <h2>Keep the right domains in your portfolio.</h2>
                  <p>
                    Check the expiration, confirm your registrar’s actual price, then record a
                    completed renewal in the domain’s financial history.
                  </p>
                  <RenewalReviewLink
                    href="/renewals?expiration=expired&status=active#renewal-review"
                    className="renewal-overdue-link"
                  >
                    <span>
                      <strong>{data.renewalWindows.overdue.toLocaleString()}</strong> past-due
                      registration records
                    </span>
                    <ArrowUpRight size={17} />
                  </RenewalReviewLink>
                  <small>
                    Past-due records may need a fresh sync. Assame does not submit or pay for
                    renewals.
                  </small>
                </section>
              </div>
              <div className="renewal-window-heading">
                <h2>Choose a planning window</h2>
                <p>
                  Cumulative registration counts; one domain can have several recorded
                  registrations.
                </p>
              </div>
              <div className="renewal-window-grid">
                {[7, 30, 60, 90].map((days) => (
                  <RenewalReviewLink
                    href={`/renewals?days=${days}&status=active#renewal-review`}
                    className="card renewal-window-card"
                    key={days}
                  >
                    <span>
                      Within {days} days <ArrowUpRight size={15} />
                    </span>
                    <strong>
                      {data.renewalWindows[
                        ('days' + days) as keyof typeof data.renewalWindows
                      ].toLocaleString()}
                    </strong>
                    <small>registration records</small>
                  </RenewalReviewLink>
                ))}
              </div>
              <section className="card renewal-schedule">
                <div className="card-header">
                  <div>
                    <h2>Your renewal calendar</h2>
                    <p>
                      Current month and the next 11 months · UTC dates · {data.currency} estimates
                      only
                    </p>
                  </div>
                  <Badge>Recorded dates</Badge>
                </div>
                <div className="renewal-month-grid">
                  {data.renewalMonths.map((item) => (
                    <RenewalReviewLink
                      href={`/renewals?month=${item.month}&status=active#renewal-review`}
                      key={item.month}
                      className="renewal-month"
                    >
                      <div>
                        <span>{item.label}</span>
                        <ArrowUpRight size={13} />
                      </div>
                      <strong>
                        {item.count.toLocaleString()}{' '}
                        <small>{item.count === 1 ? 'registration' : 'registrations'}</small>
                      </strong>
                      <div className="renewal-month-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${(item.count / Math.max(...data.renewalMonths.map((month) => month.count), 1)) * 100}%`,
                          }}
                        />
                      </div>
                      <p>
                        {formatMoney(item.cost, data.currency)} <span>recorded</span>
                      </p>
                    </RenewalReviewLink>
                  ))}
                </div>
                <p className="renewal-calendar-note">
                  Open a month to review its matching domains below. Missing prices are not treated
                  as free renewals.
                </p>
              </section>
              <section
                id="renewal-review"
                tabIndex={-1}
                className="renewal-review"
                aria-label="Matching renewal domains"
              >
                <Suspense>
                  <DomainTable renewals />
                </Suspense>
              </section>
            </>
          )}
          {section === 'analytics' && (
            <>
              <div className="insights-summary" aria-label="Portfolio insight summary">
                <div>
                  <span>Portfolio domains</span>
                  <strong>{data.total.toLocaleString()}</strong>
                  <small>In this workspace</small>
                </div>
                <div>
                  <span>Marketplace listings</span>
                  <strong>{data.listingCount.toLocaleString()}</strong>
                  <small>Recorded listing records</small>
                </div>
                <div>
                  <span>Registrar groups</span>
                  <strong>{data.registrars.length.toLocaleString()}</strong>
                  <small>Leading groups shown below</small>
                </div>
              </div>
              <div className="analytics-actions">
                <Link href="/domains?attention=price-mismatch&status=all">
                  <AlertTriangle size={18} />
                  <span>
                    <strong>{data.conflicts.toLocaleString()} listing price differences</strong>
                    <small>Review domains with differing recorded prices or currencies</small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
                <Link href="/domains?listing=none&status=active">
                  <Link2 size={18} />
                  <span>
                    <strong>{data.missing.toLocaleString()} domains without listings</strong>
                    <small>Review active domains with no marketplace listing records</small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
              </div>
              <AdvancedFinancialReport />
              <MarketplaceAnalytics data={data} />
              {Number(data.undatedCash) > 0 && (
                <div className="notice mb-6">
                  {formatMoney(data.undatedCash, data.currency)} of recorded cash has no payout date
                  and is not plotted in monthly charts.{' '}
                  <Link href="/sales" className="text-link">
                    Set actual received dates in the sales ledger
                  </Link>
                  .
                </div>
              )}
              <div className="analytics-grid">
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Portfolio growth</h3>
                      <p>Persisted domain creation dates · six months</p>
                    </div>
                    <Badge>{workspace.demo ? 'Demo data' : 'Recorded data'}</Badge>
                  </div>
                  <GrowthChart data={data.growth} />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Registrar distribution</h3>
                      <p>Leading recorded registrars · up to 10 groups</p>
                    </div>
                  </div>
                  <Distribution
                    total={data.registrars.slice(0, 10).reduce((sum, item) => sum + item._count, 0)}
                    label="registrations shown"
                    data={data.registrars
                      .slice(0, 10)
                      .map((r) => ({ label: r.registrar, value: r._count }))}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Cash and acquisition spending</h3>
                      <p>{data.currency} only · no currency conversion</p>
                    </div>
                  </div>
                  <PerformanceChart data={data.monthly} currency={data.currency} />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Extensions</h3>
                      <p>Leading recorded extensions · up to 10 groups</p>
                    </div>
                  </div>
                  <Distribution
                    total={data.tlds.reduce((sum, item) => sum + item._count, 0)}
                    data={data.tlds.map((t) => ({ label: `.${t.tld}`, value: t._count }))}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Marketplace coverage</h3>
                      <p>Listing records, including multiple listings per domain</p>
                    </div>
                  </div>
                  <Distribution
                    total={data.marketplaces.reduce((sum, item) => sum + item._count, 0)}
                    label="listing records"
                    data={data.marketplaces.map((item) => ({
                      label: item.marketplace === 'spaceship' ? 'SellerHub' : item.marketplace,
                      value: item._count,
                    }))}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Domain age</h3>
                      <p>From recorded registration dates; unknown dates stay unknown</p>
                    </div>
                  </div>
                  <Distribution
                    total={data.ageBands.reduce((sum, item) => sum + item.value, 0)}
                    label="domain records"
                    data={data.ageBands}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>Sales by marketplace</h3>
                      <p>Agreement amounts and received payments stay distinct</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Marketplace</th>
                          <th>Sales</th>
                          <th>Signed agreements</th>
                          <th>Cash collected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!data.salesMarketplaces.length && (
                          <tr>
                            <td colSpan={4}>
                              <div className="insights-table-empty">
                                <CircleDollarSign size={22} />
                                <strong>No marketplace sales recorded</strong>
                                <p>Recorded agreements and received payments will appear here.</p>
                                <Link href="/sales" className="text-link">
                                  Open sales ledger <ArrowRight size={14} />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )}
                        {data.salesMarketplaces.map((item) => (
                          <tr key={item.marketplace}>
                            <td>{item.marketplace}</td>
                            <td>{item.count}</td>
                            <td>{formatMoney(item.agreements, data.currency)}</td>
                            <td>{formatMoney(item.collected, data.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="notice mt-6">
                <Activity size={18} />
                <div>
                  <strong>Traffic data is provider-specific.</strong>
                  <p>
                    Dated daily traffic feeds (such as Afternic’s daily statistics) are summed in
                    the combined daily chart below. Undated cumulative listing counters (such as
                    Atom’s all-time domain views, offers, and shortlists) appear in the cards above
                    without fabricated daily dates. Spaceship and Dynadot traffic is unavailable in
                    the integrated APIs.
                  </p>
                </div>
              </div>
              <section className="card mt-6">
                <div className="card-header">
                  <div>
                    <h3>Combined marketplace daily traffic</h3>
                    <p>
                      Dated daily views and leads aggregated across connected marketplaces · latest
                      30 days
                    </p>
                  </div>
                  <Badge>{data.providerStats.length ? 'API verified' : 'Unavailable'}</Badge>
                </div>
                {data.providerStats.length ? (
                  <TrafficChart data={data.providerStats} />
                ) : (
                  <Empty
                    title="Traffic needs a live connection"
                    description="Connect a marketplace that supplies dated daily statistics (such as Afternic) and run a sync to collect daily views and leads. No traffic has been estimated."
                  />
                )}
              </section>
            </>
          )}
          {section === 'sales' && <Sales data={data} />}
          {section === 'integrations' && <Integrations accounts={data.accounts} />}
          {section === 'sync' && <ActivityCenter data={data} />}
        </>
      )}
      <DomainForm key={`add-${add}`} open={add} onOpenChange={setAdd} />
      <ImportWizard key={`import-${importOpen}`} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
function Overview({ data, onSync, syncing }: { data: Summary; onSync(): void; syncing: boolean }) {
  const workspace = useWorkspace();
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('180d');
  const {
    data: trend,
    isPending: trendPending,
    error: trendError,
  } = useQuery({
    queryKey: ['financial-trends', trendPeriod],
    queryFn: () => read<FinancialTrend>(`view=financialTrends&period=${trendPeriod}`),
  });
  const netReturn = new Decimal(data.netReturn || '0');
  const isProfitable = netReturn.gte(0);
  const kpis = [
    {
      label: 'Total domains',
      value: data.total.toLocaleString(),
      icon: Globe2,
      note: 'Across your entire workspace',
      tone: 'teal',
    },
    {
      label: 'Total listed BIN value',
      value: formatMoney(data.listingValue, data.currency),
      icon: Layers3,
      note: `${data.listedBinDomainCount} domains · lowest listed BIN per domain`,
      tone: 'blue',
    },
    {
      label: 'Total portfolio investment',
      value: formatMoney(data.totalInvestment, data.currency),
      icon: Wallet,
      note: `Acquisitions (${formatMoney(data.investment, data.currency)}) + renewals (${formatMoney(data.renewals, data.currency)}) + holding costs`,
      tone: 'purple',
    },
    {
      label: isProfitable ? 'Net portfolio profit' : 'Net portfolio loss',
      value: isProfitable
        ? `+${formatMoney(data.netReturn, data.currency)}`
        : `-${formatMoney(netReturn.abs().toString(), data.currency)}`,
      icon: TrendingUp,
      note: `${formatMoney(data.collected, data.currency)} collected less ${formatMoney(data.totalInvestment, data.currency)} invested`,
      tone: isProfitable ? 'green' : 'amber',
    },
  ];
  return (
    <>
      <div className="overview-context">
        <span>
          <span className="status-dot" />{' '}
          {workspace.demo ? 'Synthetic portfolio · demo data' : 'Your persisted portfolio'}
          <span className="context-dot">·</span>
          {new Intl.DateTimeFormat('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }).format(new Date())}
        </span>
        <Button variant="ghost" onClick={onSync} disabled={syncing}>
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          Sync all
        </Button>
      </div>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="card kpi-card" key={k.label}>
            <div className="kpi-label">
              {k.label}
              <span className={`kpi-icon icon-${k.tone}`}>
                <k.icon size={17} />
              </span>
            </div>
            <strong className="kpi-value">{k.value}</strong>
            <small>{k.note}</small>
          </div>
        ))}
      </div>
      <div className="attention-strip">
        <Link href="/renewals?days=30&status=active">
          <span className="attention-icon amber">
            <CalendarClock size={18} />
          </span>
          <span>
            <strong>{data.expiring} domains</strong> expiring in 30 days
          </span>
          <ChevronRight size={15} />
        </Link>
        <Link href="/domains?attention=price-mismatch&status=all">
          <span className="attention-icon rose">
            <AlertTriangle size={18} />
          </span>
          <span>
            <strong>{data.conflicts} price mismatches</strong> to review
          </span>
          <ChevronRight size={15} />
        </Link>
        <Link href="/renewals">
          <span className="attention-icon teal">
            <CircleDollarSign size={18} />
          </span>
          <span>
            <strong>{formatMoney(data.renewalForecast, data.currency)}</strong> upcoming annual
            renewals
          </span>
          <ChevronRight size={15} />
        </Link>
      </div>
      <div className="overview-charts">
        <FinancialPerformance
          trend={trend}
          period={trendPeriod}
          onPeriodChange={setTrendPeriod}
          loading={trendPending}
          error={!!trendError}
          synthetic={workspace.demo}
        />
        <section className="card distribution-card">
          <div className="card-header">
            <div>
              <h3>A world of extensions</h3>
              <p>Leading extensions · up to 10 groups</p>
            </div>
            <Globe2 size={18} className="muted" />
          </div>
          <Distribution
            total={data.tlds.reduce((sum, item) => sum + item._count, 0)}
            data={data.tlds.map((t) => ({ label: `.${t.tld}`, value: t._count }))}
          />
        </section>
      </div>
      <div className="overview-bottom">
        <div className="main-stack">
          <Suspense>
            <DomainTable compact />
          </Suspense>
          <section className="card">
            <div className="card-header">
              <div>
                <h3>A little attention goes a long way</h3>
                <p>Opportunities to keep your portfolio in good shape</p>
              </div>
              <Sparkles size={18} className="text-teal-600" />
            </div>
            <div className="opportunity-list">
              <Link href="/domains?listing=none&status=active">
                <span className="opportunity-icon">
                  <Link2 size={18} />
                </span>
                <div>
                  <strong>{data.missing} domains without marketplace listings</strong>
                  <p>Review your selling coverage and find new opportunities.</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
              <Link href="/integrations">
                <span className="opportunity-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>
                    {data.accounts.filter((a) => a.status === 'connected').length} live provider
                    connections
                  </strong>
                  <p>Connect an account to verify inventory and pricing.</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            </div>
          </section>
        </div>
        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h3>On the horizon</h3>
              <Link href="/renewals" aria-label="View renewals">
                <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="upcoming-list">
              {data.upcoming.length ? (
                data.upcoming.slice(0, 4).map((r) => (
                  <Link href={`/domains/${r.domain.id}`} key={r.id}>
                    <span className="calendar-mini">
                      <small>
                        {new Date(r.expiresAt!).toLocaleString('en-US', {
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </small>
                      <strong>{new Date(r.expiresAt!).getUTCDate()}</strong>
                    </span>
                    <div>
                      <strong>{r.domain.name}</strong>
                      <small>{r.registrar}</small>
                    </div>
                    <span>{formatMoney(r.renewalCost, r.currency)}</span>
                  </Link>
                ))
              ) : (
                <p className="muted p-5 text-sm">No recorded upcoming expirations.</p>
              )}
            </div>
            <Link className="card-bottom-link" href="/renewals">
              View all renewals
              <ArrowRight size={14} />
            </Link>
          </section>
          <section className="card">
            <div className="card-header">
              <h3>Recent activity</h3>
              <Activity size={17} className="muted" />
            </div>
            <div className="activity-list">
              {data.activity.length ? (
                data.activity.slice(0, 5).map((a) => (
                  <div key={a.id}>
                    <span className="activity-dot">
                      <CheckCheck size={12} />
                    </span>
                    <div>
                      <strong>{a.label}</strong>
                      <small>{formatDate(a.createdAt)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted text-sm">Your portfolio activity will appear here.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      <div className="quiet-banner">
        <span className="quiet-banner-icon">
          <Globe2 size={25} />
        </span>
        <div>
          <strong>Your next opportunity. Already in perspective.</strong>
          <p>A connected portfolio means more time for what comes next.</p>
        </div>
        <Link href="/integrations">
          Explore integrations
          <ArrowRight size={16} />
        </Link>
      </div>
    </>
  );
}
