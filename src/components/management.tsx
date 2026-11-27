'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicTheme } from './public-theme';
import { activityEmailOptions, type ActivityEmailPreferences } from '@/lib/activity-email-policy';
import { useAppearance } from './appearance';
import {
  Activity,
  CircleAlert,
  Clock3,
  Bell,
  Settings2,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Trash2,
  Users,
  UserRound,
  Layers3,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { ProviderLogo } from './provider-logo';
import { ProviderCapabilities } from './provider-capabilities';
import { availableProviderIds, providers, type ProviderId } from '@/integrations/catalog';
import { api, read, formatDate, formatMoney, type Account, type Summary } from './client';
import { useWorkspace } from './shell';
import { Badge, Button, Empty, Field, Input, Modal } from './ui';
export function Integrations({ accounts }: { accounts: Account[] }) {
  const [provider, setProvider] = useState<ProviderId>();
  const [busy, setBusy] = useState(false);
  const [connectionAction, setConnectionAction] = useState<{ account: Account; remove: boolean }>();
  const query = useQueryClient();
  const workspace = useWorkspace();
  const admin = ['OWNER', 'ADMIN'].includes(workspace.role);
  async function act(action: string, data: unknown, success: string) {
    setBusy(true);
    try {
      await api(action, data);
      await query.invalidateQueries();
      toast.success(success);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="integration-banner">
        <span className="integration-banner-icon">
          <Link2 size={26} />
        </span>
        <div>
          <h3>Less switching. More perspective.</h3>
          <p>
            Securely connect your accounts. Your API credentials are encrypted, and sync is
            read-only.
          </p>
        </div>
        <Badge tone="green">
          <ShieldCheck size={12} />
          Encrypted credentials
        </Badge>
      </div>
      <div className="section-tabs">
        <button className="tab-active">
          All integrations <span>{availableProviderIds.length}</span>
        </button>
        <span className="tab-note">Official APIs only</span>
      </div>
      <div className="provider-grid">
        {availableProviderIds.map((id) => {
          const meta = providers[id];
          const connected = accounts.filter((a) => a.providerId === id);
          return (
            <section className="card integration-card" key={id}>
              <div className="integration-top">
                <ProviderLogo provider={id} size={44} />
                <Badge tone={connected.some((a) => a.status === 'connected') ? 'green' : 'neutral'}>
                  {connected.some((a) => a.status === 'connected') ? 'Connected' : 'Not connected'}
                </Badge>
              </div>
              <h3>
                {meta.name}
                <a
                  href={meta.docs}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${meta.name} API documentation`}
                >
                  <ArrowUpRight size={16} />
                </a>
              </h3>
              <span className="integration-kind">{meta.kind}</span>
              <Link className="text-link" href={`/integrations/${id}`}>
                Setup guide and API access →
              </Link>
              <p>{meta.description}</p>
              <ProviderCapabilities provider={id} />
              <details className="permissions">
                <summary>
                  <LockKeyhole size={13} />
                  Required permissions
                  <ChevronDown size={13} />
                </summary>
                <p>{meta.permissions}</p>
              </details>
              {connected.map((account) => (
                <div className="account-connection" key={account.id}>
                  <div>
                    <strong>{account.label}</strong>
                    <Badge
                      tone={
                        account.status === 'connected'
                          ? 'green'
                          : account.status === 'error'
                            ? 'red'
                            : 'neutral'
                      }
                    >
                      {account.status}
                    </Badge>
                  </div>
                  <small>
                    Last successful sync:{' '}
                    {account.lastSyncAt ? formatDate(account.lastSyncAt) : 'Never'}
                  </small>
                  <div className="account-actions">
                    <Button
                      disabled={!admin || busy || account.status === 'disconnected'}
                      onClick={() =>
                        void act(
                          'connection.test',
                          { accountId: account.id },
                          'Remote API confirmed read access',
                        )
                      }
                    >
                      Test connection
                    </Button>
                    <Button
                      disabled={
                        workspace.role === 'VIEWER' || busy || account.status === 'disconnected'
                      }
                      onClick={() =>
                        void act('sync.queue', { accountId: account.id }, 'Read-only sync queued')
                      }
                    >
                      <RefreshCw size={13} />
                      Sync
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!admin || busy || account.status === 'disconnected'}
                      aria-label={`Disconnect ${account.label}`}
                      onClick={() => setConnectionAction({ account, remove: false })}
                    >
                      <Unplug size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!admin || busy}
                      aria-label={`Remove API key for ${account.label}`}
                      title="Remove API key"
                      onClick={() => setConnectionAction({ account, remove: true })}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="integration-card-footer">
                <Button
                  className="w-full"
                  disabled={!admin || workspace.demo}
                  onClick={() => setProvider(id)}
                >
                  <Link2 size={15} />
                  {connected.length ? 'Add another account' : `Connect ${meta.name}`}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
      <div className="notice mt-6">
        <ShieldCheck size={19} />
        <div>
          <strong>Your accounts, under your control.</strong>
          <p>
            Supported provider changes require workspace opt-in and an exact confirmed preview.
            Nameserver changes also require this domain&apos;s connected registrar. Paid renewals
            are not available.
          </p>
        </div>
      </div>
      <Modal
        title={`Connect ${provider ? providers[provider].name : 'provider'}`}
        description="Credentials are encrypted at rest and never returned to the browser after submission."
        open={!!provider}
        onOpenChange={(v) => {
          if (!v) setProvider(undefined);
        }}
      >
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await api('connection.save', {
                provider,
                label: form.get('label'),
                apiKey: form.get('apiKey'),
                apiSecret: form.get('apiSecret') || undefined,
                userId: form.get('userId') || undefined,
                apiUser: form.get('apiUser') || undefined,
                accountPassword: form.get('accountPassword') || undefined,
                clientIp: form.get('clientIp') || undefined,
              });
              await query.invalidateQueries();
              setProvider(undefined);
              toast.success('Credentials saved. Test the connection to verify access.');
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="notice">
            <KeyRound size={19} />
            <p>
              {provider && providers[provider].permissions}
              {provider && (
                <>
                  {' '}
                  <Link className="text-link" href={`/integrations/${provider}`}>
                    Read the setup guide
                  </Link>
                </>
              )}
            </p>
          </div>
          <Field label="Account label">
            <Input name="label" required placeholder="My primary account" />
          </Field>
          <Field
            label={
              provider === 'godaddy'
                ? 'Personal Access Token (domains.domain:read)'
                : provider === 'atom'
                  ? 'Seller API token'
                  : provider === 'atomRegistrar'
                    ? 'Registrar API token'
                    : provider === 'sedo'
                      ? 'Sedo Partner ID'
                      : 'API key'
            }
          >
            <Input name="apiKey" type="password" required maxLength={512} autoComplete="off" />
          </Field>
          {provider === 'atom' && (
            <Field
              label="Atom seller user ID"
              hint="The numeric user_id associated with this token in Atom’s API Access page."
            >
              <Input
                name="userId"
                required
                inputMode="numeric"
                pattern="[0-9]+"
                autoComplete="off"
              />
            </Field>
          )}
          {provider === 'sedo' && (
            <>
              <Field label="Sedo username">
                <Input name="apiUser" required maxLength={25} autoComplete="off" />
              </Field>
              <Field label="Sedo account password">
                <Input
                  name="accountPassword"
                  type="password"
                  required
                  maxLength={16}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          {provider === 'namecheap' && (
            <>
              <Field
                label="Namecheap username"
                hint="Your Namecheap account username, not your email address."
              >
                <Input name="apiUser" required maxLength={50} autoComplete="off" />
              </Field>
              <Field
                label="Allowlisted public IPv4"
                hint="Use the outbound IPv4 address of this deployment and add it to your Namecheap API allowlist."
              >
                <Input name="clientIp" required autoComplete="off" />
              </Field>
            </>
          )}
          {(provider === 'afternic' ||
            provider === 'spaceship' ||
            provider === 'dynadot' ||
            provider === 'sedo') && (
            <Field
              label={
                provider === 'dynadot'
                  ? 'API secret (Secret Key)'
                  : provider === 'sedo'
                    ? 'Sedo sign key'
                    : 'API secret'
              }
              hint={
                provider === 'dynadot'
                  ? 'Used for Dynadot RESTful v2 X-Signature signing (Tools → API → Secret Key). Leave blank only for legacy API3 keys.'
                  : undefined
              }
            >
              <Input
                name="apiSecret"
                type="password"
                required={provider !== 'dynadot'}
                autoComplete="off"
              />
            </Field>
          )}
          <Button variant="primary" disabled={busy}>
            {busy ? 'Encrypting…' : 'Save encrypted credentials'}
          </Button>
        </form>
      </Modal>
      <Modal
        title={connectionAction?.remove ? 'Remove API key?' : 'Disconnect provider?'}
        description={
          connectionAction?.remove
            ? `Remove ${connectionAction.account.label} from Connections and delete its saved key in Assame. Imported assets and job history are kept. To revoke the key, use the provider’s dashboard.`
            : 'Assame will delete the saved credentials and keep the disconnected account in Connections.'
        }
        open={!!connectionAction}
        onOpenChange={(v) => {
          if (!v) setConnectionAction(undefined);
        }}
      >
        <div className="dialog-actions">
          <Button onClick={() => setConnectionAction(undefined)}>Keep connection</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!connectionAction) return;
              const { account, remove } = connectionAction;
              if (
                await act(
                  remove ? 'connection.remove' : 'connection.disconnect',
                  { accountId: account.id },
                  remove ? 'API key removed' : 'Provider disconnected',
                )
              )
                setConnectionAction(undefined);
            }}
          >
            {connectionAction?.remove ? 'Remove API key' : 'Disconnect'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
type Job = {
  kind: string;
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  added: number;
  updated: number;
  error: string | null;
  account: { label: string; providerId: string; status?: string };
  reviewed?: boolean;
  providerAccountId: string;
  _count: { items: number };
  target: {
    domainId: string | null;
    domainName: string;
    action: string | null;
    price: { previous: string | null; requested: string; currency: string } | null;
  } | null;
  items?: { domainName: string; status: string; message: string | null }[];
  errors: { id: string; code: string; message: string }[];
};
const jobKinds: Record<string, string> = {
  price: 'BIN price change',
  providerChange: 'Provider action',
  statistics: 'Listing statistics',
  delist: 'Legacy delisting',
  nameservers: 'Legacy nameserver change',
};
const jobStatusLabels: Record<string, string> = {
  completed: 'Completed',
  running: 'Running',
  queued: 'Queued',
  unverified: 'Needs verification',
  failed: 'Failed',
  partial: 'Partially completed',
};
function jobStatus(job: Job) {
  return ['delist', 'nameservers'].includes(job.kind) ? 'unverified' : job.status;
}
const providerActions: Record<string, string> = {
  addListing: 'Listing creation',
  removeListing: 'Listing removal',
  changeNameservers: 'Nameserver change',
};
function jobTitle(job: Job) {
  return providerActions[job.target?.action ?? ''] ?? jobKinds[job.kind] ?? 'Inventory sync';
}
function jobPrice(job: Job) {
  const price = job.target?.price;
  if (!price) return null;
  const requested = formatMoney(price.requested, price.currency);
  return price.previous
    ? `${formatMoney(price.previous, price.currency)} → ${requested}`
    : `Requested ${requested}`;
}
function jobProvider(job: Job) {
  if (job.kind === 'price' && job.account.providerId === 'spaceship') return 'SellerHub';
  return providers[job.account.providerId as ProviderId]?.name ?? job.account.providerId;
}

export function ActivityCenter({ data }: { data: Summary }) {
  const query = useQueryClient();
  const { id: workspaceId } = useWorkspace();
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', workspaceId],
    queryFn: () => read<Job[]>('view=sync'),
    refetchInterval: 5000,
  });
  const [detailId, setDetailId] = useState<string>();
  const detail = jobs.find(({ id }) => id === detailId);
  const [activityLimit, setActivityLimit] = useState(10);
  const [jobLimit, setJobLimit] = useState(10);
  const [jobFilter, setJobFilter] = useState('all');
  const [sections, setSections] = useState({
    'provider-jobs': true,
    'workspace-history': true,
    'connection-health': true,
  });
  function setSection(id: keyof typeof sections, open: boolean) {
    setSections((current) => ({ ...current, [id]: open }));
  }
  function sectionToggle(id: keyof typeof sections, label: string) {
    return (
      <Button
        variant="ghost"
        aria-expanded={sections[id]}
        aria-controls={`${id}-content`}
        onClick={() => setSection(id, !sections[id])}
      >
        {sections[id] ? 'Collapse' : 'Expand'}
        <span className="sr-only"> {label}</span>
        {sections[id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </Button>
    );
  }
  async function openJob(job: Job) {
    setDetailId(job.id);
    if (job.reviewed || !['failed', 'partial', 'unverified'].includes(jobStatus(job))) return;
    const key = ['jobs', workspaceId];
    try {
      await api('job.review', { workspaceId, jobId: job.id, finishedAt: job.finishedAt });
      await query.cancelQueries({ queryKey: key });
      query.setQueryData<Job[]>(key, (items) =>
        items?.map((item) =>
          item.id === job.id && item.finishedAt === job.finishedAt
            ? { ...item, reviewed: true }
            : item,
        ),
      );
      void query.invalidateQueries({ queryKey: key });
    } catch {
      toast.error('Could not mark this job reviewed. Reopen its details to retry.');
    }
  }
  const activeJobs = jobs.filter((job) => ['queued', 'running'].includes(jobStatus(job)));
  const reviewJobs = jobs.filter(
    (job) => !job.reviewed && ['failed', 'partial', 'unverified'].includes(jobStatus(job)),
  );
  const visibleJobs =
    jobFilter === 'active' ? activeJobs : jobFilter === 'review' ? reviewJobs : jobs;
  type ActivityEvent = Summary['activity'][number] & { unread: boolean };
  const acknowledging = useRef(new Set<string>());
  const activity = useQuery({
    queryKey: ['workspace-activity', workspaceId],
    queryFn: () => read<ActivityEvent[]>('view=activity'),
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (activity.isError || !sections['workspace-history']) return;
    const ids = activity.data
      ?.filter((event) => event.unread && !acknowledging.current.has(event.id))
      .map((event) => event.id);
    if (!ids?.length) return;
    ids.forEach((id) => acknowledging.current.add(id));
    const key = ['workspace-activity', workspaceId];
    void api('activity.read', { workspaceId, ids })
      .then(async () => {
        await query.cancelQueries({ queryKey: key });
        const readIds = new Set(ids);
        query.setQueryData<ActivityEvent[]>(key, (events) =>
          events?.map((event) => (readIds.has(event.id) ? { ...event, unread: false } : event)),
        );
        await query.invalidateQueries({ queryKey: ['activity-unread', workspaceId] });
      })
      .catch(() => {
        // Retry on a later successful history refresh.
      })
      .finally(() => ids.forEach((id) => acknowledging.current.delete(id)));
  }, [activity.data, activity.dataUpdatedAt, activity.isError, query, workspaceId, sections]);
  async function queue(accountId: string) {
    try {
      await api('sync.queue', { accountId });
      await query.invalidateQueries();
      toast.success('Synchronization queued');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="activity-center">
      {!data.workerConnected && (
        <div className="notice notice-amber mb-6">
          <Activity size={18} />
          <div>
            <strong>Background jobs may be delayed.</strong>
            <p>Your portfolio is still available. Contact support if the delay continues.</p>
          </div>
        </div>
      )}
      <div className="activity-overview">
        <div>
          <span className="activity-overview-icon">
            <Clock3 size={18} />
          </span>
          <div>
            <strong>{activeJobs.length}</strong>
            <span>Active jobs</span>
          </div>
        </div>
        <div>
          <span className="activity-overview-icon activity-overview-review">
            <CircleAlert size={18} />
          </span>
          <div>
            <strong>{reviewJobs.length}</strong>
            <span>Recent jobs to review</span>
          </div>
        </div>
        <div>
          <span className="activity-overview-icon">
            <Link2 size={18} />
          </span>
          <div>
            <strong>{data.accounts.filter((a) => a.status === 'connected').length}</strong>
            <span>Connected accounts</span>
          </div>
        </div>
      </div>
      <nav className="activity-shortcuts" aria-label="Activity Center sections">
        <a href="#provider-jobs" onClick={() => setSection('provider-jobs', true)}>
          Provider jobs
        </a>
        <a href="#workspace-history" onClick={() => setSection('workspace-history', true)}>
          Workspace history
        </a>
        <a href="#connection-health" onClick={() => setSection('connection-health', true)}>
          Connections
        </a>
      </nav>
      <div className="activity-center-layout">
        <div className="activity-center-main">
          <section className="card activity-jobs" id="provider-jobs">
            <div className="card-header">
              <div>
                <h3>Provider jobs</h3>
                <p>Track syncs, listing changes and statistics refreshes.</p>
              </div>
              {sectionToggle('provider-jobs', 'provider jobs')}
            </div>
            <div id="provider-jobs-content" hidden={!sections['provider-jobs']}>
              <select
                aria-label="Filter provider jobs"
                className="input"
                value={jobFilter}
                onChange={(event) => {
                  setJobFilter(event.target.value);
                  setJobLimit(10);
                }}
              >
                <option value="all">All jobs</option>
                <option value="active">Active</option>
                <option value="review">Needs review</option>
              </select>
              {visibleJobs.length ? (
                <>
                  <ul className="activity-job-list">
                    {visibleJobs.slice(0, jobLimit).map((job) => {
                      const status = jobStatus(job);
                      const provider = job.account.providerId as ProviderId;
                      const domain = job.target?.domainName ?? job.items?.[0]?.domainName;
                      const more = job.target ? 0 : Math.max(0, job._count.items - 1);
                      const price = jobPrice(job);
                      return (
                        <li key={job.id} data-job-status={status}>
                          <span className="activity-job-icon">
                            {Object.hasOwn(providers, provider) ? (
                              <ProviderLogo provider={provider} size={26} />
                            ) : (
                              <Activity size={16} />
                            )}
                          </span>
                          <div className="activity-job-label">
                            <strong>
                              {domain && job.target?.domainId ? (
                                <Link href={`/domains/${job.target.domainId}`}>{domain}</Link>
                              ) : (
                                (domain ?? jobTitle(job))
                              )}
                              {domain && more > 0 && (
                                <span className="activity-job-more"> +{more}</span>
                              )}
                            </strong>
                            <small>
                              {domain && `${jobTitle(job)} · `}
                              {jobProvider(job)} · {job.account.label}
                            </small>
                            {price && <span className="activity-job-price">{price}</span>}
                            {!price && job.kind === 'read' && status === 'completed' && (
                              <small>
                                {job.added} added · {job.updated} updated
                              </small>
                            )}
                            {job.error && <small className="activity-job-error">{job.error}</small>}
                          </div>
                          <time dateTime={job.createdAt}>
                            {formatDate(job.createdAt)}
                            <span>
                              {new Date(job.createdAt).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </time>
                          <Badge
                            tone={
                              status === 'completed'
                                ? 'green'
                                : status === 'failed'
                                  ? 'red'
                                  : 'amber'
                            }
                          >
                            {jobStatusLabels[status] ?? status}
                          </Badge>
                          <div className="activity-job-actions">
                            <Button variant="ghost" onClick={() => void openJob(job)}>
                              Details
                            </Button>
                            {job.kind === 'read' &&
                              job.account.status !== 'removed' &&
                              ['failed', 'partial'].includes(job.status) && (
                                <Button
                                  variant="ghost"
                                  onClick={() => void queue(job.providerAccountId)}
                                >
                                  Retry
                                </Button>
                              )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {visibleJobs.length > jobLimit && (
                    <Button variant="ghost" onClick={() => setJobLimit((limit) => limit + 10)}>
                      Show more jobs
                    </Button>
                  )}
                </>
              ) : (
                <Empty
                  title={
                    jobFilter === 'all'
                      ? 'No provider jobs yet'
                      : jobFilter === 'active'
                        ? 'No active provider jobs'
                        : 'No recent jobs need review'
                  }
                  description={
                    jobFilter === 'all'
                      ? 'Inventory syncs and marketplace changes will appear here.'
                      : 'Select All jobs to see the full recent history.'
                  }
                />
              )}
            </div>
          </section>
          <section className="card activity-history" id="workspace-history">
            <div className="card-header">
              <div>
                <h3>Workspace history</h3>
                <p>Recent portfolio, payment, connection and team changes.</p>
              </div>
              {sectionToggle('workspace-history', 'workspace history')}
            </div>
            <div id="workspace-history-content" hidden={!sections['workspace-history']}>
              {activity.isPending ? (
                <p className="muted">Loading workspace history…</p>
              ) : activity.isError ? (
                <p className="muted">Workspace history is temporarily unavailable.</p>
              ) : activity.data.length ? (
                <div className="activity-list">
                  {activity.data.slice(0, activityLimit).map((event) => (
                    <div key={event.id}>
                      <span className="activity-dot">
                        <Activity size={12} />
                      </span>
                      <div>
                        <strong>{event.label}</strong>
                        {event.domainName &&
                          (event.domainId ? (
                            <Link
                              className="activity-history-domain"
                              href={`/domains/${event.domainId}`}
                            >
                              {event.domainName}
                            </Link>
                          ) : (
                            <span className="activity-history-domain">{event.domainName}</span>
                          ))}
                        {event.description && <small>{event.description}</small>}
                      </div>
                      <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                    </div>
                  ))}
                  {activity.data.length > activityLimit && (
                    <Button onClick={() => setActivityLimit((limit) => limit + 10)}>
                      Show more
                    </Button>
                  )}
                </div>
              ) : (
                <Empty
                  title="No workspace changes yet"
                  description="Your recent changes will appear here."
                />
              )}
            </div>
          </section>
        </div>
        <section className="card activity-connections" id="connection-health">
          <div className="card-header">
            <div>
              <h3>Connection health</h3>
              <p>
                Manual and scheduled inventory syncs use one unit per connected account. Listing
                statistics use one unit per listing. Provider change verification uses none.
              </p>
            </div>
            {sectionToggle('connection-health', 'connection health')}
          </div>
          <div id="connection-health-content" hidden={!sections['connection-health']}>
            <Link className="text-link" href="/connections">
              Manage connections
              <ArrowUpRight size={15} />
            </Link>
            {data.accounts.length ? (
              data.accounts.map((a) => (
                <div className="activity-connection" key={a.id}>
                  <span className="connection-symbol">
                    <Link2 size={19} />
                  </span>
                  <div className="activity-connection-name">
                    <strong>
                      {providers[a.providerId as ProviderId]?.name}{' '}
                      <span className="muted">/ {a.label}</span>
                    </strong>
                    <small>
                      Last successful sync: {a.lastSyncAt ? formatDate(a.lastSyncAt) : 'Never'}
                    </small>
                  </div>
                  <Badge
                    tone={
                      a.status === 'connected' ? 'green' : a.status === 'error' ? 'red' : 'neutral'
                    }
                  >
                    {a.status}
                  </Badge>
                  <div className="activity-connection-actions">
                    <select
                      className="input"
                      aria-label={`Sync schedule for ${a.label}`}
                      value={a.syncEveryHours}
                      onChange={async (e) => {
                        try {
                          await api('sync.schedule', {
                            accountId: a.id,
                            hours: Number(e.target.value),
                          });
                          await query.invalidateQueries();
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      <option value={0}>Manual only</option>
                      {[6, 12, 24, 48, 168].map((h) => (
                        <option key={h} value={h}>
                          Every {h} hours
                        </option>
                      ))}
                    </select>
                    <Button onClick={() => void queue(a.id)} disabled={a.status === 'disconnected'}>
                      <RefreshCw size={14} />
                      Sync now
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                title="Everything starts with a connection"
                description="Connect a provider to retrieve and verify your remote portfolio."
              >
                <Link href="/integrations" className="btn btn-primary">
                  Explore integrations
                  <ArrowUpRight size={15} />
                </Link>
              </Empty>
            )}
          </div>
        </section>
      </div>
      <Modal
        title="Provider job details"
        description={
          detail
            ? `${jobTitle(detail)} · ${jobProvider(detail)} · ${detail.account.label}`
            : undefined
        }
        wide
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) setDetailId(undefined);
        }}
      >
        <div className="stack">
          <Badge>{detail ? (jobStatusLabels[jobStatus(detail)] ?? jobStatus(detail)) : null}</Badge>
          {detail && ['delist', 'nameservers'].includes(detail.kind) ? (
            <p>Legacy operation; the provider result was not independently verified.</p>
          ) : detail?.target ? (
            <div className="notice">
              <div>
                <strong>{detail.target.domainName}</strong>
                {jobPrice(detail) && <p>{jobPrice(detail)}</p>}
              </div>
            </div>
          ) : (
            <p>
              {detail?.added} added · {detail?.updated} updated · {detail?._count.items} recorded
              items
            </p>
          )}
          {detail?.error && <div className="notice notice-amber">{detail.error}</div>}
          {detail?.errors
            .filter((error) => error.message !== detail.error)
            .map((e) => (
              <div className="notice" key={e.id}>
                <p>{e.message}</p>
              </div>
            ))}
          {detail?.items && detail.items.length > 0 && (
            <div className="pt-2">
              <h4 className="text-xs font-semibold mb-2">
                Affected domains ({detail.items.length})
              </h4>
              <div className="table-scroll max-h-56">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Status</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="font-medium text-xs font-mono">{item.domainName}</td>
                        <td>
                          <Badge
                            tone={
                              ['delist', 'nameservers'].includes(detail.kind) ||
                              item.status === 'delisted'
                                ? 'amber'
                                : 'green'
                            }
                          >
                            {['delist', 'nameservers'].includes(detail.kind)
                              ? 'unverified'
                              : item.status}
                          </Badge>
                        </td>
                        <td className="text-xs text-muted">
                          {['delist', 'nameservers'].includes(detail.kind)
                            ? 'Legacy record; provider outcome not verified.'
                            : item.message || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
export function Settings({
  activeTab,
  accountPanel,
}: {
  activeTab?: string;
  accountPanel?: ReactNode;
}) {
  const workspace = useWorkspace();
  const panels = [
    {
      id: 'general',
      label: 'Workspace',
      description: 'Name and reporting currency',
      icon: Settings2,
    },
    {
      id: 'preferences',
      label: 'Preferences',
      description: 'Appearance and reminders',
      icon: Bell,
    },
    { id: 'team', label: 'Team & roles', description: 'People and access levels', icon: Users },
    {
      id: 'publishing',
      label: 'Provider controls',
      description: 'Review and publishing permissions',
      icon: ShieldCheck,
    },
    {
      id: 'security',
      label: 'Account security',
      description: 'Sign-in, sessions and data controls',
      icon: LockKeyhole,
    },
    {
      id: 'profile',
      label: 'Account profile',
      description: 'Personal details and display name',
      icon: UserRound,
    },
    {
      id: 'workspaces',
      label: 'Workspaces',
      description: 'Owned and shared portfolios',
      icon: Layers3,
    },
  ];
  const selected = panels.find((panel) => panel.id === activeTab) ?? panels[0];
  const {
    notifications: savedNotifications,
    renewalEmails: savedRenewalEmails,
    renewalEmailsAvailable,
    activityEmails: savedActivityEmails,
    activityEmailPreferences,
    activityEmailsAvailable,
    status: preferenceStatus,
    saveNotifications,
  } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState(false);
  const [memberRemoval, setMemberRemoval] = useState<{ id: string; email: string } | null>(null);
  const [leaveWorkspace, setLeaveWorkspace] = useState(false);
  const { data: members = [] } = useQuery({
    queryKey: ['team'],
    enabled: selected.id === 'team',
    queryFn: () =>
      read<
        {
          id: string;
          role: string;
          customRole: { name: string } | null;
          user: { name: string | null; email: string };
        }[]
      >('view=team'),
  });
  const { data: customRoles = [] } = useQuery({
    queryKey: ['customRoles'],
    enabled: selected.id === 'team',
    queryFn: () =>
      read<
        {
          id: string;
          name: string;
          baseRole: string;
          allowProviderWrites: boolean;
          allowDomainDeletion: boolean;
          allowFinanceRecords: boolean;
          allowSync: boolean;
        }[]
      >('view=customRoles'),
  });
  const query = useQueryClient();
  async function save(action: string, data: unknown) {
    setBusy(true);
    try {
      await api(action, data);
      await query.invalidateQueries();
      toast.success('Settings saved');
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings categories">
        <span className="settings-nav-caption">SETTINGS</span>
        {panels.map(({ id, label, description, icon: Icon }) => (
          <Link
            key={id}
            href={`/settings?tab=${id}`}
            aria-current={selected.id === id ? 'page' : undefined}
          >
            <Icon size={17} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <div className="settings-sections">
        <header className="settings-panel-heading">
          <h2>{selected.label}</h2>
          <p>{selected.description}</p>
        </header>
        {accountPanel}
        {selected.id === 'general' && (
          <section className="card" id="general">
            <div className="card-header">
              <div>
                <h3>Workspace details</h3>
                <p>A home for your domain investments.</p>
              </div>
            </div>
            <form
              method="post"
              className="settings-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const values = Object.fromEntries(new FormData(e.currentTarget));
                if (await save('settings.save', values)) window.location.reload();
              }}
            >
              <Field label="Workspace name">
                <Input name="name" defaultValue={workspace.name} required />
              </Field>
              <Field
                label="Reporting currency"
                hint="Totals include only this currency. No implicit exchange-rate conversion."
              >
                <select name="currency" defaultValue={workspace.currency}>
                  {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Button
                variant="primary"
                disabled={busy || !['OWNER', 'ADMIN'].includes(workspace.role)}
              >
                Save workspace
              </Button>
            </form>
          </section>
        )}
        {selected.id === 'preferences' && (
          <section className="card" id="preferences">
            <div className="card-header">
              <div>
                <h3>Appearance & notifications</h3>
                <p>Choose your preferred appearance and reminders.</p>
              </div>
            </div>
            <form
              method="post"
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                setBusy(true);
                void saveNotifications(
                  form.get('notifications') === 'on',
                  renewalEmailsAvailable
                    ? form.get('renewalEmails') === 'on'
                    : savedRenewalEmails && form.get('renewalEmails') !== 'on'
                      ? false
                      : undefined,
                  activityEmailsAvailable
                    ? form.get('activityEmails') === 'on'
                    : savedActivityEmails && form.get('activityEmails') !== 'on'
                      ? false
                      : undefined,
                  activityEmailsAvailable
                    ? {
                        activityBulkEmails: form.get('activityBulkEmails') === 'on',
                        activityPriceEmails: form.get('activityPriceEmails') === 'on',
                        activitySyncEmails: form.get('activitySyncEmails') === 'on',
                      }
                    : undefined,
                )
                  .then(async () => {
                    await query.invalidateQueries({ queryKey: ['summary'] });
                    toast.success('Preferences saved');
                  })
                  .catch((error: Error) => toast.error(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              <div className="appearance-setting">
                <span>Appearance</span>
                <PublicTheme />
              </div>
              <label className="check-label">
                <input
                  key={String(savedNotifications)}
                  type="checkbox"
                  name="notifications"
                  defaultChecked={savedNotifications}
                  disabled={preferenceStatus !== 'authenticated'}
                />
                Enable in-app notifications
              </label>
              <label className="check-label">
                <input
                  key={String(savedRenewalEmails)}
                  type="checkbox"
                  name="renewalEmails"
                  defaultChecked={savedRenewalEmails}
                  disabled={
                    preferenceStatus !== 'authenticated' ||
                    (!renewalEmailsAvailable && !savedRenewalEmails)
                  }
                />
                Email me weekly renewal reminders for workspaces I own
              </label>
              <small className="muted">
                {renewalEmailsAvailable
                  ? 'Reminders cover active domains expiring within 30 days and require a verified account email.'
                  : 'Renewal emails are not configured. You can still turn off a previously saved choice.'}
              </small>
              <label className="check-label">
                <input
                  key={String(savedActivityEmails)}
                  type="checkbox"
                  name="activityEmails"
                  defaultChecked={savedActivityEmails}
                  disabled={
                    preferenceStatus !== 'authenticated' ||
                    (!activityEmailsAvailable && !savedActivityEmails)
                  }
                />
                Email me about important workspace activity
              </label>
              {activityEmailsAvailable && (
                <fieldset
                  className="activity-email-options"
                  disabled={preferenceStatus !== 'authenticated'}
                >
                  <legend>Activity email options</legend>
                  {(Object.keys(activityEmailOptions) as (keyof ActivityEmailPreferences)[]).map(
                    (key) => (
                      <label className="check-label" key={key}>
                        <input
                          key={String(activityEmailPreferences[key])}
                          type="checkbox"
                          name={key}
                          defaultChecked={activityEmailPreferences[key]}
                        />
                        {activityEmailOptions[key]}
                      </label>
                    ),
                  )}
                </fieldset>
              )}
              <small className="muted">
                <span className="block">
                  When activity emails are on, you also get listing, import, renewal, sale and
                  payout updates. Bulk edits and removals send one summary per batch.
                </span>
                {!activityEmailsAvailable && <span>Activity email is currently unavailable.</span>}
              </small>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy || preferenceStatus !== 'authenticated'}>
                  Save preferences
                </Button>
              </div>
            </form>
          </section>
        )}
        {selected.id === 'team' && (
          <section className="card" id="team">
            <div className="card-header">
              <div>
                <h3>Team members</h3>
                <p>Manage who can view and change this portfolio.</p>
              </div>
              <Users size={19} className="muted" />
            </div>
            {members.map((member) => (
              <div className="team-row" key={member.id}>
                <span className="avatar">{member.user.name?.slice(0, 2).toUpperCase() || 'U'}</span>
                <div>
                  <strong>{member.user.name}</strong>
                  <small>{member.user.email}</small>
                </div>
                <Badge>
                  {member.customRole
                    ? `${member.customRole.name} (${member.role.toLowerCase()})`
                    : member.role.toLowerCase()}
                </Badge>
                {workspace.role === 'OWNER' &&
                  workspace.workspaceOwner &&
                  member.role !== 'OWNER' && (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => setMemberRemoval({ id: member.id, email: member.user.email })}
                    >
                      Remove member
                    </Button>
                  )}
              </div>
            ))}
            {workspace.role === 'OWNER' && (
              <form
                method="post"
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save('team.save', Object.fromEntries(new FormData(e.currentTarget)));
                }}
              >
                <div className="form-grid">
                  <Field label="Registered user’s email">
                    <Input name="email" type="email" required />
                  </Field>
                  <Field label="Role">
                    <select name="role">
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                      <option value="ADMIN">Admin</option>
                      {customRoles.map((role) => (
                        <option key={role.id} value={`custom:${role.id}`}>
                          {role.name} ({role.baseRole.toLowerCase()})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Button disabled={busy}>Add or update member</Button>
                <small className="muted">
                  Users must register first. No invitation emails are sent.
                </small>
              </form>
            )}
            {workspace.role !== 'OWNER' && (
              <Button variant="danger" disabled={busy} onClick={() => setLeaveWorkspace(true)}>
                Leave workspace
              </Button>
            )}
            {workspace.role === 'OWNER' && (
              <div className="settings-form">
                <h4>Custom workspace roles</h4>
                <p className="muted">
                  Workspace owners can restrict selected actions within a base access level. Base
                  roles never gain extra permissions. Permission changes affect all assigned
                  members.
                </p>
                {customRoles.map((role) => (
                  <div className="settings-form" key={role.id}>
                    <span>
                      {role.name} · {role.baseRole.toLowerCase()} · provider publishing{' '}
                      {role.allowProviderWrites ? 'allowed' : 'blocked'} · domain deletion{' '}
                      {role.allowDomainDeletion ? 'allowed' : 'blocked'} · financial records{' '}
                      {role.allowFinanceRecords ? 'allowed' : 'blocked'} · synchronization{' '}
                      {role.allowSync ? 'allowed' : 'blocked'}
                    </span>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void save('team.customRole.delete', { id: role.id })}
                    >
                      Delete
                    </Button>
                    <details>
                      <summary>Edit role permissions</summary>
                      <form
                        method="post"
                        className="settings-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const expected = {
                            name: role.name,
                            allowProviderWrites: role.allowProviderWrites,
                            allowDomainDeletion: role.allowDomainDeletion,
                            allowFinanceRecords: role.allowFinanceRecords,
                            allowSync: role.allowSync,
                          };
                          void save('team.customRole.update', {
                            id: role.id,
                            expected,
                            next: {
                              name: form.get('name'),
                              allowProviderWrites: form.has('allowProviderWrites'),
                              allowDomainDeletion: form.has('allowDomainDeletion'),
                              allowFinanceRecords: form.has('allowFinanceRecords'),
                              allowSync: form.has('allowSync'),
                            },
                          });
                        }}
                      >
                        <Field label="Role name">
                          <Input
                            name="name"
                            required
                            minLength={2}
                            maxLength={60}
                            defaultValue={role.name}
                          />
                        </Field>
                        <p>
                          Base access: {role.baseRole.toLowerCase()}. To change it, create a new
                          role and reassign members.
                        </p>
                        <label>
                          <input
                            type="checkbox"
                            name="allowProviderWrites"
                            defaultChecked={role.allowProviderWrites}
                            disabled={role.baseRole === 'VIEWER'}
                          />{' '}
                          Allow confirmed provider publishing
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            name="allowDomainDeletion"
                            defaultChecked={role.allowDomainDeletion}
                          />{' '}
                          Allow domain deletion
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            name="allowFinanceRecords"
                            defaultChecked={role.allowFinanceRecords}
                          />{' '}
                          Allow sale, payment, expense and renewal records
                        </label>
                        <label>
                          <input type="checkbox" name="allowSync" defaultChecked={role.allowSync} />{' '}
                          Allow starting and scheduling provider synchronization
                        </label>
                        <Button disabled={busy}>Save role changes</Button>
                      </form>
                    </details>
                  </div>
                ))}
                <form
                  method="post"
                  className="settings-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void save('team.customRole.create', {
                      name: form.get('name'),
                      baseRole: form.get('baseRole'),
                      allowProviderWrites: form.has('allowProviderWrites'),
                      allowDomainDeletion: form.has('allowDomainDeletion'),
                      allowFinanceRecords: form.has('allowFinanceRecords'),
                      allowSync: form.has('allowSync'),
                    });
                  }}
                >
                  <Field label="Role name">
                    <Input name="name" required minLength={2} maxLength={60} />
                  </Field>
                  <Field label="Base access">
                    <select name="baseRole">
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </Field>
                  <label>
                    <input type="checkbox" name="allowProviderWrites" /> Allow confirmed provider
                    publishing
                  </label>
                  <label>
                    <input type="checkbox" name="allowDomainDeletion" defaultChecked /> Allow domain
                    deletion
                  </label>
                  <label>
                    <input type="checkbox" name="allowFinanceRecords" defaultChecked /> Allow sale,
                    payment, expense and renewal records
                  </label>
                  <label>
                    <input type="checkbox" name="allowSync" defaultChecked /> Allow starting and
                    scheduling provider synchronization
                  </label>
                  <Button disabled={busy}>Create custom role</Button>
                </form>
              </div>
            )}
          </section>
        )}
        {selected.id === 'publishing' && (
          <section className="card" id="publishing">
            <div className="card-header">
              <div>
                <h3>Provider price publishing</h3>
                <p>Control whether editors can confirm marketplace BIN price changes.</p>
              </div>
              <Badge>{workspace.pricePublishingEnabled ? 'Enabled' : 'Off'}</Badge>
            </div>
            <form
              method="post"
              className="settings-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  await api('settings.pricePublishing', {
                    enabled: new FormData(event.currentTarget).get('enabled') === 'on',
                  });
                  toast.success('Publishing preference saved');
                  window.location.reload();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="check-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={workspace.pricePublishingEnabled}
                  disabled={
                    !workspace.pricePublishingAvailable ||
                    !['OWNER', 'ADMIN'].includes(workspace.role)
                  }
                />
                Allow confirmed provider BIN price changes
              </label>
              <p className="muted text-xs">
                Every change fetches the remote price, requires preview and explicit confirmation,
                runs in the worker, and succeeds only after a fresh provider read. Spaceship
                requires sellerhub:write; Atom requires seller.write. Premium listing restrictions
                still apply.
              </p>
              {!workspace.pricePublishingAvailable && (
                <p className="muted text-xs">
                  Marketplace price publishing is unavailable in this workspace.
                </p>
              )}
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !workspace.pricePublishingAvailable ||
                  !['OWNER', 'ADMIN'].includes(workspace.role)
                }
              >
                Save publishing preference
              </Button>
            </form>
          </section>
        )}
        {selected.id === 'publishing' && (
          <section className="card" id="provider-actions">
            <div className="card-header">
              <div>
                <h3>Provider actions</h3>
                <p>Enable previewed listing changes and supported nameserver changes.</p>
              </div>
              <Badge>{workspace.providerActionsEnabled ? 'Enabled' : 'Off'}</Badge>
            </div>
            <form
              method="post"
              className="settings-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const enabled = new FormData(e.currentTarget).get('enabled') === 'on';
                setBusy(true);
                try {
                  await api('settings.providerActions', { enabled });
                  toast.success('Provider action preference saved');
                  window.location.reload();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="check-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={workspace.providerActionsEnabled}
                  disabled={
                    !workspace.pricePublishingAvailable ||
                    !['OWNER', 'ADMIN'].includes(workspace.role)
                  }
                />
                Allow confirmed listing changes and supported nameserver changes
              </label>
              <p className="muted text-xs">
                Each operation requires an exact preview and confirmation. Nameserver changes
                require an administrator and a supported registrar connection for the domain. Paid
                renewals and Atom Premium submissions are not available.
              </p>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !workspace.pricePublishingAvailable ||
                  !['OWNER', 'ADMIN'].includes(workspace.role)
                }
              >
                Save provider action preference
              </Button>
            </form>
          </section>
        )}
        {selected.id === 'security' && (
          <section className="card" id="security">
            <div className="card-header">
              <div>
                <h3>Workspace data</h3>
                <p>Your assets and credentials are yours.</p>
              </div>
              <ShieldCheck size={19} className="text-teal-600" />
            </div>
            <div className="settings-form">
              <div className="notice">
                <LockKeyhole size={18} />
                <p>Export your portfolio or manage the accounts connected to this workspace.</p>
              </div>
              <a className="btn btn-secondary" href="/api/export">
                Export portfolio CSV
                <ArrowUpRight size={15} />
              </a>
              <Link href="/connections" className="text-link">
                Manage API credentials
                <ArrowUpRight size={15} />
              </Link>
              <hr />
              <div>
                <strong>Delete this workspace</strong>
                <p className="muted text-sm mt-2">
                  Permanently remove its portfolio, credentials, and finance records.
                </p>
              </div>
              <Button
                variant="danger"
                disabled={workspace.role !== 'OWNER'}
                onClick={() => setRemove(true)}
              >
                Delete workspace
              </Button>
            </div>
          </section>
        )}
      </div>
      <Modal
        title={leaveWorkspace ? 'Leave workspace' : 'Remove workspace member'}
        description={
          leaveWorkspace
            ? 'You will lose access to this workspace. Its data remains with the owner.'
            : `Remove ${memberRemoval?.email ?? 'this member'} from this workspace? Their other workspaces and account are unaffected. If this is their only workspace, an empty personal workspace will be created for them.`
        }
        open={leaveWorkspace || memberRemoval !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLeaveWorkspace(false);
            setMemberRemoval(null);
          }
        }}
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (leaveWorkspace) {
                await api('team.leave', {});
                window.location.assign('/settings?tab=workspaces');
              } else if (memberRemoval) {
                await api('team.remove', { membershipId: memberRemoval.id });
                setMemberRemoval(null);
                await query.invalidateQueries();
                toast.success('Workspace access removed');
              }
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {leaveWorkspace ? 'Confirm leave workspace' : 'Confirm remove member'}
        </Button>
      </Modal>
      <Modal
        title="Delete workspace"
        description="This permanently removes local records. It does not remove or change anything at your providers."
        open={remove}
        onOpenChange={setRemove}
      >
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api('workspace.delete', { confirmation: form.get('confirmation') });
              window.location.assign('/');
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <Field label={`Type DELETE ${workspace.name} to confirm`}>
            <Input name="confirmation" required />
          </Field>
          <Button variant="danger">Permanently delete workspace</Button>
        </form>
      </Modal>
    </div>
  );
}
