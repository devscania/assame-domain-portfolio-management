'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, read, formatDate, type Listing } from './client';
import { ProviderLabel } from './provider-label';
import { Button } from './ui';
import { useWorkspace } from './shell';

export function ListingStatistics({ listings }: { listings: Listing[] }) {
  const available = listings.filter(
    (l) => l.analytics && Object.values(l.analytics).some((v) => typeof v === 'number'),
  );
  if (!available.length) return <span className="muted text-xs">Not collected / unavailable</span>;
  return (
    <div className="stack">
      {available.map((l) => (
        <div
          key={l.id}
          className="text-xs"
          title={l.analytics?.period || 'Provider listing counters; period not supplied'}
        >
          <strong>
            <ProviderLabel name={l.marketplace}>
              {l.marketplace === 'afternic'
                ? 'Afternic'
                : l.marketplace === 'atom'
                  ? 'Atom'
                  : l.marketplace}
            </ProviderLabel>
          </strong>
          <div>
            {l.analytics?.views ?? '—'} views
            {l.analytics?.leads !== undefined ? ` · ${l.analytics.leads} leads` : ''}
            {l.analytics?.offers !== undefined ? ` · ${l.analytics.offers} offers` : ''}
            {l.analytics?.shortlists !== undefined ? ` · ${l.analytics.shortlists} shortlists` : ''}
          </div>
          <small className="muted">
            API ·{' '}
            {l.analytics?.observedAt
              ? formatDate(l.analytics.observedAt)
              : l.verifiedAt
                ? formatDate(l.verifiedAt)
                : 'collection time unavailable'}
          </small>
        </div>
      ))}
    </div>
  );
}
export function RefreshListingStatistics({ domainIds }: { domainIds: string[] }) {
  const workspace = useWorkspace();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  const notified = useRef('');
  const { data: progress } = useQuery({
    queryKey: ['statistics-progress', jobs],
    enabled: jobs.length > 0,
    queryFn: () =>
      read<{ id: string; status: string; updated: number; error: string | null }[]>(
        `view=jobStatus&ids=${jobs.join(',')}`,
      ),
    refetchInterval: (q) =>
      q.state.data?.length === jobs.length &&
      q.state.data.every((j) => ['completed', 'partial', 'failed'].includes(j.status))
        ? false
        : 2000,
  });
  const finished =
    jobs.length > 0 &&
    progress?.length === jobs.length &&
    progress.every((j) => ['completed', 'partial', 'failed'].includes(j.status));
  const pending = jobs.length > 0 && !finished;
  useEffect(() => {
    if (
      !jobs.length ||
      !progress ||
      progress.length !== jobs.length ||
      !progress.every((j) => ['completed', 'partial', 'failed'].includes(j.status)) ||
      notified.current === jobs.join(',')
    )
      return;
    notified.current = jobs.join(',');
    void cache.invalidateQueries({ queryKey: ['domains'] });
    void cache.invalidateQueries({ queryKey: ['domain'] });
    void cache.invalidateQueries({ queryKey: ['summary'] });
    if (progress.every((j) => j.status === 'completed'))
      toast.success('Marketplace statistics refreshed.');
    else toast.error('Some statistics were unavailable. Review the job in Activity Center.');
  }, [jobs, progress, cache]);
  return (
    <Button
      disabled={busy || pending || workspace.demo || workspace.role === 'VIEWER'}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api<{ jobs: string[] }>('listing.statistics.queue', { domainIds });
          setJobs(result.jobs);
          await cache.invalidateQueries();
          toast.success('Statistics refresh queued. Follow progress in Activity Center.');
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy
        ? 'Queuing…'
        : pending
          ? `Fetching statistics · ${progress?.reduce((sum, j) => sum + j.updated, 0) || 0} updated`
          : 'Fetch marketplace statistics'}
    </Button>
  );
}
