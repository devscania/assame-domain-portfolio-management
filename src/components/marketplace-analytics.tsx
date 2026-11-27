'use client';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Eye, EyeOff, Info } from 'lucide-react';
import { providers } from '@/integrations/catalog';
import { formatDate, type Summary } from './client';
import { useWorkspace } from './shell';
import { ProviderLogo } from './provider-logo';
import { Badge } from './ui';
const count = (value: string | null | undefined) =>
  value == null ? '—' : Number(value).toLocaleString();
export function MarketplaceAnalytics({ data }: { data: Summary }) {
  const workspace = useWorkspace();
  return (
    <section className="marketplace-insights">
      <div className="insights-section-heading">
        <div>
          <span className="section-eyebrow">Marketplace activity</span>
          <h2>Marketplace listing counters</h2>
          <p>Views, leads and offers from each provider, kept separate from your sales.</p>
        </div>
        <Link href="/listings" className="text-link">
          Manage listings <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="marketplace-metric-grid">
        {(['afternic', 'atom', 'spaceship', 'dynadot'] as const).map((provider) => {
          const metrics = data.marketplaceCounters.find((item) => item.marketplace === provider);
          const available = !!metrics?.observedCount;
          const supported = provider === 'afternic' || provider === 'atom';
          const name = provider === 'spaceship' ? 'SellerHub' : providers[provider].name;
          return (
            <article
              className={`card marketplace-metric ${!available || !supported ? 'marketplace-metric-empty' : ''}`}
              key={provider}
              aria-label={`${providers[provider].name} listing statistics`}
            >
              <div className="marketplace-metric-heading">
                <ProviderLogo provider={provider} size={32} />
                <h3>{name}</h3>
                <Badge tone={available && supported ? 'green' : 'neutral'}>
                  {!available || !supported
                    ? 'Unavailable'
                    : workspace.demo
                      ? 'Synthetic'
                      : metrics.verifiedCount === metrics.observedCount
                        ? 'API data'
                        : 'Recorded data'}
                </Badge>
              </div>
              {!supported ? (
                <div className="metric-unavailable">
                  <span>
                    <EyeOff size={22} />
                  </span>
                  <h4>Traffic statistics not available</h4>
                  <p>
                    Marketplace views and leads are not exposed by the currently integrated API. No
                    traffic is estimated.
                  </p>
                </div>
              ) : available ? (
                <>
                  <div className="metric-primary">
                    <span>
                      <Eye size={14} />
                      Views
                    </span>
                    <strong>{count(metrics.views)}</strong>
                  </div>
                  <dl className="metric-secondary">
                    <div>
                      <dt>{provider === 'atom' ? 'Offers' : 'Leads'}</dt>
                      <dd>{count(provider === 'atom' ? metrics.offers : metrics.leads)}</dd>
                    </div>
                    {provider === 'atom' && (
                      <div>
                        <dt>Shortlists</dt>
                        <dd>{count(metrics.shortlists)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="metric-source">
                    <span>
                      Coverage{' '}
                      <strong>
                        {metrics.observedCount} / {metrics.listingCount}
                      </strong>
                    </span>
                    <span>
                      Collected{' '}
                      {metrics.lastObservedAt ? formatDate(metrics.lastObservedAt) : 'Not recorded'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="metric-unavailable">
                  <span>
                    <BarChart3 size={22} />
                  </span>
                  <h4>No statistics collected yet</h4>
                  <p>
                    Refresh supported listing statistics to see provider-reported activity here.
                  </p>
                  <Link
                    href={
                      data.accounts.some((account) => account.providerId === provider)
                        ? '/listings'
                        : '/integrations'
                    }
                    className="text-link"
                  >
                    {data.accounts.some((account) => account.providerId === provider)
                      ? 'View listings'
                      : 'Connect marketplace'}{' '}
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              )}
              <div className="metric-period">
                {provider === 'atom'
                  ? 'All-time domain history, including prior listings'
                  : supported
                    ? 'Reporting period not supplied by provider'
                    : 'Provider capability limitation'}
              </div>
            </article>
          );
        })}
      </div>
      <div className="insights-footnote">
        <Info size={16} />
        <p>
          Provider totals have different reporting periods and are not combined into the daily
          chart. Activity counters are not sales or collected revenue.{' '}
          <Link href="/listings" className="text-link">
            Select listings to refresh their statistics
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
