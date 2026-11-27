'use client';
import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { useRef } from 'react';
import { domainTableQuery, domainTableSearch } from '@/lib/domain-table-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Search,
  SlidersHorizontal,
  Columns3,
  PencilLine,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Badge, Empty, Input, Modal, Field } from './ui';
import { api, read, formatMoney, formatDate, type DomainRow, type Summary } from './client';
import { useWorkspace } from './shell';
import { ListingPriceEditor } from './listing-price-editor';
import { ProviderLogo } from './provider-logo';
import { isAvailableProvider, providers, providerIdForName as providerFromLabel } from '@/integrations/catalog';
import { listingNeedsReview, listingStatusLabel } from '@/integrations/listing-status';
import { comparisonLabels } from '@/lib/comparison-labels';
import { ProviderAction } from './provider-action';
import { ProviderBatch } from './provider-batch';
import { providerBatchLimit } from '@/integrations/provider-batch-options';
import { RenewalCostEditor } from './renewal-cost-editor';
import { AskingPriceEditor } from './asking-price-editor';
import { ListingStatistics, RefreshListingStatistics } from './listing-statistics';
export function DomainTable({
  matrix = false,
  compact = false,
  renewals = false,
}: {
  matrix?: boolean;
  compact?: boolean;
  renewals?: boolean;
}) {
  const initial = useSearchParams();
  const pathname = usePathname();
  const initialQuery = domainTableQuery(initial, matrix, renewals);
  const lastWritten = useRef(initial.toString());
  const [q, setQ] = useState(initialQuery.q);
  const [debounced, setDebounced] = useState(q);
  const [page, setPage] = useState(initialQuery.page);
  const [tld, setTld] = useState(initialQuery.tld);
  const [status, setStatus] = useState(initialQuery.status);
  const [registrar, setRegistrar] = useState(initialQuery.registrar);
  const [tag, setTag] = useState(initialQuery.tag);
  const [take, setTake] = useState(initialQuery.take);
  const [sort, setSort] = useState(initialQuery.sort);
  const [direction, setDirection] = useState(initialQuery.direction);
  const [comparison, setComparison] = useState(initialQuery.comparison);
  const [listing, setListing] = useState(initialQuery.listing);
  const [attention, setAttention] = useState(initialQuery.attention);
  const [expiration, setExpiration] = useState(initialQuery.expiration);
  const [days, setDays] = useState(initialQuery.days);
  const [month, setMonth] = useState(initialQuery.month);
  const [filters, setFilters] = useState(
    renewals || !!(initialQuery.tld || initialQuery.registrar || initialQuery.tag),
  );
  useEffect(() => {
    const incoming = initial.toString();
    if (incoming === lastWritten.current) return;
    lastWritten.current = incoming;
    const next = domainTableQuery(initial, matrix, renewals);
    setQ(next.q);
    setDebounced(next.q);
    setPage(next.page);
    setTld(next.tld);
    setStatus(next.status);
    setRegistrar(next.registrar);
    setTag(next.tag);
    setTake(next.take);
    setSort(next.sort);
    setDirection(next.direction);
    setComparison(next.comparison);
    setListing(next.listing);
    setAttention(next.attention);
    setExpiration(next.expiration);
    setDays(next.days);
    setMonth(next.month);
  }, [initial, matrix, renewals]);
  useEffect(() => {
    if (compact) return;
    const next = domainTableSearch({
      q: debounced,
      tld,
      status,
      registrar,
      tag,
      take,
      page,
      sort,
      direction,
      comparison,
      listing,
      attention,
      expiration,
      days,
      month,
    });
    lastWritten.current = next;
    const url = (next ? `${pathname}?${next}` : pathname) + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, '', url);
    }
  }, [
    compact,
    pathname,
    debounced,
    tld,
    status,
    registrar,
    tag,
    take,
    page,
    sort,
    direction,
    comparison,
    listing,
    attention,
    expiration,
    days,
    month,
  ]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [providerBatch, setProviderBatch] = useState<{
    mode: 'addListing' | 'changeNameservers';
    domains: DomainRow[];
  }>();
  const [visibility, setVisibility] = useState<VisibilityState>({
    acquisitionCost: !matrix && !compact && !renewals,
    afternic: !renewals,
    askingPrice: !renewals,
    status: !compact,
    select: !compact,
    expiration: !compact,
    nameservers: !compact && !renewals,
    atom: !compact && !renewals,
    spaceship: !compact && !renewals,
    sedo: !compact && !renewals,
  });
  const [bulk, setBulk] = useState(false);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkField, setBulkField] = useState<
    'askingPrice' | 'acquisitionCost' | 'renewalCost' | 'registrar' | 'status' | 'nameservers'
  >('askingPrice');
  const [preview, setPreview] = useState<{
    rows: {
      id: string;
      name: string;
      status?: string;
      askingPrice?: string | null;
      acquisitionCost?: string;
      currency?: string;
      registrar?: string;
      renewalCost?: string | null;
      nameservers?: string;
    }[];
    price?: string;
    value?: string;
    field: string;
    token: string;
  }>();
  const [busy, setBusy] = useState(false);
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (q === debounced) return;
    const timeout = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [q, debounced]);
  const params = new URLSearchParams({
    view: 'domains',
    q: debounced,
    page: String(page),
    take: compact ? '6' : String(take),
    sort,
    direction,
    ...(matrix && { matrix: 'true' }),
    ...(comparison && { comparison }),
    ...(listing && { listing }),
    ...(attention && { attention }),
    ...(expiration && { expiration }),
    ...(days && { days }),
    ...(month && { month }),
    ...(tld && { tld }),
    ...(status && { status }),
    ...(registrar && { registrar }),
    ...(tag && { tag }),
  });
  const queryKey = params.toString();
  useEffect(() => setSelection({}), [queryKey]);
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => read<Summary>('view=summary'),
    enabled: !compact,
  });
  const { data, isPending, isPlaceholderData, error } = useQuery({
    queryKey: ['domains', queryKey],
    queryFn: () => read<{ rows: DomainRow[]; total: number; page: number; take: number }>(queryKey),
    placeholderData: compact ? undefined : (previous) => previous,
    refetchInterval: ({ state }) =>
      state.data?.rows.some((row) =>
        row.listings.some((listing) => listing.marketplace === 'afternic' && listing.status === 'PENDING'),
      ) ? 30000 : false,
  });
  const visibleRegistration = useCallback(
    (domain: DomainRow) =>
      domain.registrations.find((item) => item.id === domain.selectedRegistrationId) ??
      [...domain.registrations]
        .sort(
          (a, b) =>
            (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) -
            (b.expiresAt ? Date.parse(b.expiresAt) : Infinity),
        )
        .find((r) => {
          if (registrar && r.registrar !== registrar) return false;
          return true;
        }) ??
      domain.registrations[0],
    [registrar],
  );
  const columns = useMemo<ColumnDef<DomainRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all domains on this page"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Domain name',
        cell: ({ row }) => {
          const pendingVerifications = row.original.listings.filter((l) => listingNeedsReview(l.status));
          return (
            <Link className="domain-link" href={`/domains/${row.original.id}`}>
              <span>
                <strong>{row.original.name}</strong>
                {pendingVerifications.length > 0 && (
                  <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                    Pending at{' '}
                    {pendingVerifications
                      .map((l) => l.marketplace === 'spaceship' ? 'SellerHub'
                        : l.marketplace === 'afternic' ? 'Afternic' : l.marketplace)
                      .join(', ')}
                  </span>
                )}
                {!compact && (
                  <small>
                    {row.original.tags.map((t) => t.tag.name).join(' · ') ||
                      `${row.original.source === 'demo' ? 'Synthetic data' : row.original.source} source`}
                  </small>
                )}
              </span>
            </Link>
          );
        },
      },
      ...(!matrix
        ? [
            {
              id: 'registrar',
              header: 'Registrar',
              cell: ({ row }: { row: { original: DomainRow } }) => (
                <span className="registrar-name">
                  {providerFromLabel(visibleRegistration(row.original)?.registrar || '') ? (
                    <ProviderLogo
                      provider={providerFromLabel(
                        visibleRegistration(row.original)?.registrar || '',
                      )!}
                      size={22}
                    />
                  ) : (
                    <span className="provider-dot" />
                  )}
                  {visibleRegistration(row.original)?.registrar || '—'}
                </span>
              ),
            },
            {
              accessorKey: 'acquisitionCost',
              header: 'Acquisition',
              cell: ({ row }: { row: { original: DomainRow } }) =>
                formatMoney(row.original.acquisitionCost, row.original.currency),
            },
            {
              id: 'expiration',
              header: 'Expiration',
              cell: ({ row }: { row: { original: DomainRow } }) => {
                const date = visibleRegistration(row.original)?.expiresAt;
                const days = date
                  ? Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <span className={days !== null && days <= 30 ? 'expiry-warning' : 'muted'}>
                    {date ? formatDate(date) : '—'}
                    {days !== null && days <= 30 && (
                      <small>{days < 0 ? 'Expired' : `${days} days left`}</small>
                    )}
                  </span>
                );
              },
            },
          ]
        : []),
      ...(renewals
        ? [
            {
              id: 'renewalCost',
              header: 'Annual renewal cost',
              cell: ({ row }: { row: { original: DomainRow } }) => {
                const registration = visibleRegistration(row.original);
                return (
                  <RenewalCostEditor registration={registration} domainName={row.original.name} />
                );
              },
            },
          ]
        : []),
      ...(!compact ? [{
        id: 'nameservers',
        header: 'Nameservers',
        cell: ({ row }: { row: { original: DomainRow } }) => {
          const hosts = (visibleRegistration(row.original)?.nameservers ?? [])
            .map((host) => host.trim().toLowerCase()).filter(Boolean).sort();
          return hosts.length ? (
            <div className="domain-nameservers">
              {hosts.map((host, index) => <code key={`${host}-${index}`}>{host}</code>)}
            </div>
          ) : <span className="muted">—</span>;
        },
      }] : []),
      ...(['afternic', 'atom', 'spaceship', 'sedo', ...(matrix ? ['dynadot' as const] : [])] as const).filter(isAvailableProvider).map(
        (marketplace) => ({
          id: marketplace,
          header: marketplace === 'spaceship' ? 'SellerHub' : providers[marketplace].name,
          cell: ({ row }: { row: { original: DomainRow } }) => {
            const listing = row.original.listings.find((l) => l.marketplace === marketplace);
            return listing ? (
              <div className="listing-cell">
                {!compact && (
                  <ListingPriceEditor
                    listing={listing}
                    domainName={row.original.name}
                    domainId={row.original.id}
                    askingPrice={row.original.askingPrice}
                  />
                )}
                {matrix ? (
                  <strong>
                    {listing.binPrice === null
                      ? 'No BIN returned'
                      : formatMoney(listing.binPrice, listing.currency)}
                  </strong>
                ) : (
                  <Badge tone={listing.stale ? 'amber' : 'green'}>
                    <span className="tiny-dot" />
                    {listingStatusLabel(listing.marketplace, listing.status)}
                  </Badge>
                )}
                {matrix && (
                  <small>
                    {listing.stale
                      ? 'Stale · needs sync'
                      : listingStatusLabel(listing.marketplace, listing.status)}
                  </small>
                )}
              </div>
            ) : matrix ? (
              <div className="stack">
                <span className="not-listed">No synced listing</span>
                <ProviderAction domain={row.original} provider={marketplace} />
              </div>
            ) : (
              <span className="not-listed">—</span>
            );
          },
        }),
      ),
      {
        accessorKey: 'askingPrice',
        header: 'Asking price',
        cell: ({ row }) => <AskingPriceEditor domain={row.original} />,
      },
      ...(matrix
        ? [
            {
              id: 'statistics',
              header: 'Marketplace statistics',
              cell: ({ row }: { row: { original: DomainRow } }) => (
                <ListingStatistics listings={row.original.listings} />
              ),
            },
          ]
        : []),
      {
        accessorKey: 'status',
        header: matrix ? 'Price comparison' : 'Status',
        cell: ({ row }) =>
          matrix ? (
            <Badge
              tone={
                row.original.comparison === 'mismatch'
                  ? 'amber'
                  : row.original.comparison !== 'match'
                    ? 'neutral'
                    : 'green'
              }
            >
              {comparisonLabels[row.original.comparison || 'insufficient']}
            </Badge>
          ) : (
            <Badge
              tone={
                row.original.status === 'active'
                  ? 'green'
                  : row.original.status === 'lto'
                    ? 'purple'
                    : 'neutral'
              }
            >
              {row.original.status === 'lto' ? 'Lease-to-own' : row.original.status}
            </Badge>
          ),
      },
    ],
    [matrix, compact, renewals, visibleRegistration],
  );
  const table = useReactTable({
    data: data?.rows || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    rowCount: data?.total || 0,
    state: { rowSelection: selection, columnVisibility: visibility },
    onRowSelectionChange: setSelection,
    onColumnVisibilityChange: setVisibility,
  });
  return (
    <div className="card domain-table-card">
      {!compact && (
        <div className="portfolio-view-heading">
          <div>
            <span className="section-eyebrow">
              {attention || listing || comparison || expiration || days || month
                ? 'FILTERED PORTFOLIO'
                : 'WORKSPACE INVENTORY'}
            </span>
            <h2>
              {attention
                ? 'Listing price differences'
                : listing === 'none'
                  ? 'Domains without listings'
                  : renewals
                    ? 'Renewal review'
                    : matrix
                      ? 'Marketplace comparisons'
                      : 'Domain inventory'}
            </h2>
            <p>
              {data && !isPlaceholderData
                ? `${data.total.toLocaleString()} matching ${data.total === 1 ? 'domain' : 'domains'}`
                : 'Finding matching domains…'}
              {summary ? ` · ${summary.total.toLocaleString()} in this workspace` : ''}
            </p>
          </div>
          {sort === 'registrar' && (
            <span className="portfolio-sort-note">
              Registrar {direction === 'asc' ? 'A to Z' : 'Z to A'} · first matching registrar per
              domain
            </span>
          )}
        </div>
      )}
      {compact ? (
        <div className="card-header">
          <div>
            <h3>Portfolio at a glance</h3>
            <p>A closer look at your domain assets</p>
          </div>
          <Link className="text-link" href="/domains">
            View all domains
            <ChevronRight size={15} />
          </Link>
        </div>
      ) : (
        <>
          <div className="table-toolbar">
            <div className="table-search">
              <Search size={17} />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search domains"
                placeholder="Search domains…"
              />
            </div>
            <div className="toolbar-actions">
              {matrix && (
                <select
                  aria-label="Filter price comparison"
                  value={comparison}
                  onChange={(event) => {
                    setComparison(event.target.value);
                    setAttention('');
                    setPage(1);
                  }}
                >
                  <option value="">All comparisons</option>
                  {Object.entries(comparisonLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              <Button aria-expanded={filters} onClick={() => setFilters(!filters)}>
                <SlidersHorizontal size={15} />
                Filters
                {(tld || status || registrar || tag) && <span className="filter-active" />}
              </Button>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <Button>
                    <Columns3 size={15} />
                    <span className="hide-small">Columns</span>
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    className="dropdown portfolio-columns-menu"
                    sideOffset={8}
                    collisionPadding={16}
                  >
                    {table
                      .getAllLeafColumns()
                      .filter((c) => c.id !== 'select' && c.id !== 'name')
                      .map((c) => (
                        <Dropdown.CheckboxItem
                          key={c.id}
                          checked={c.getIsVisible()}
                          onCheckedChange={(v) => c.toggleVisibility(v)}
                        >
                          {c.getIsVisible() ? '✓' : '○'}{' '}
                          {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                        </Dropdown.CheckboxItem>
                      ))}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
              <a className="btn btn-secondary" href={`/api/export?${params}`}>
                <Download size={15} />
                <span className="hide-small">Export</span>
              </a>
            </div>
          </div>
          {(listing || attention || expiration || days || month || comparison) && (
            <div className="portfolio-filter-context" role="status">
              <span>
                {attention
                  ? 'Listing price differences across all recorded listings'
                  : listing === 'none'
                    ? `${status === 'active' ? 'Active domains' : 'Domains'} without marketplace listings`
                    : comparison
                      ? comparisonLabels[comparison as keyof typeof comparisonLabels]
                      : month
                        ? `Registrations expiring in ${new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))}`
                        : expiration === 'expired'
                          ? 'Expired registrations'
                          : days
                            ? `Registrations expiring within ${days} days`
                            : 'Upcoming registrations'}
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  setListing('');
                  setAttention('');
                  setComparison('');
                  setExpiration('');
                  setDays('');
                  setMonth('');
                  setPage(1);
                }}
              >
                Clear view filter
              </Button>
            </div>
          )}
          {filters && (
            <div className="filter-row">
              <Input
                placeholder="Extension, e.g. com"
                aria-label="Filter extension"
                value={tld}
                onChange={(e) => {
                  setTld(e.target.value.replace(/^\./, ''));
                  setPage(1);
                }}
              />
              <select
                aria-label="Filter registrar"
                value={registrar}
                onChange={(e) => {
                  setRegistrar(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All registrars</option>
                {summary?.registrars.map((r) => (
                  <option key={r.registrar} value={r.registrar}>
                    {r.registrar}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Tag"
                aria-label="Filter tag"
                value={tag}
                onChange={(e) => {
                  setTag(e.target.value);
                  setPage(1);
                }}
              />
              <select
                aria-label="Filter status"
                value={status || 'all'}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="sold">Sold</option>
                <option value="lto">Lease-to-own</option>
                <option value="expired">Expired</option>
                <option value="pending">Pending</option>
                <option value="in_escrow">In escrow</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}
          {!isPlaceholderData && Object.values(selection).some(Boolean) && (
            <div className="selection-bar">
              <span>{Object.values(selection).filter(Boolean).length} selected</span>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <Button disabled={workspace.role === 'VIEWER' || busy}>
                    <PencilLine size={15} /> Batch edit <ChevronDown size={14} />
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    className="dropdown portfolio-batch-menu"
                    sideOffset={8}
                    align="start"
                    collisionPadding={16}
                  >
                    <Dropdown.Label className="dropdown-label">
                      PORTFOLIO RECORDS ONLY
                    </Dropdown.Label>
                    {(
                      [
                        ['askingPrice', 'Internal asking price'],
                        ['acquisitionCost', 'Acquisition cost'],
                        ['renewalCost', 'Annual renewal cost'],
                        ['registrar', 'Recorded registrar'],
                        ['status', 'Domain status'],
                      ] as const
                    ).map(([field, label]) => (
                      <Dropdown.Item
                        key={field}
                        onSelect={() => {
                          setPreview(undefined);
                          setBulkValue(field === 'status' ? 'active' : '');
                          setBulkField(field);
                          setBulk(true);
                        }}
                      >
                        {label}
                      </Dropdown.Item>
                    ))}
                    <Dropdown.Separator />
                    <p className="dropdown-help">Provider prices and listings stay unchanged.</p>
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
              {!workspace.demo && workspace.providerActionsEnabled && workspace.pricePublishingAvailable &&
                workspace.role !== 'VIEWER' && (
                <>
                  <Button onClick={() => setProviderBatch({
                    mode: 'addListing', domains: data?.rows.filter((domain) => selection[domain.id]) ?? [],
                  })}>List selected</Button>
                  {['OWNER', 'ADMIN'].includes(workspace.role) && (
                    <Button onClick={() => setProviderBatch({
                      mode: 'changeNameservers', domains: data?.rows.filter((domain) => selection[domain.id]) ?? [],
                    })}>Change nameservers</Button>
                  )}
                </>
              )}
              <Button
                variant="danger"
                disabled={workspace.role === 'VIEWER' || busy}
                onClick={async () => {
                  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
                  if (
                    !confirm(
                      `Are you sure you want to delete ${selectedIds.length} selected domain(s)? This will remove them from your active portfolio.`,
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    const res = await api<{ deleted: number }>('bulk.delete', { ids: selectedIds });
                    await queryClient.invalidateQueries();
                    setSelection({});
                    toast.success(`Deleted ${res.deleted} domain(s).`);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={14} />
                Delete selected
              </Button>
              <Button variant="ghost" onClick={() => setSelection({})}>
                Clear selection
              </Button>
              <RefreshListingStatistics
                domainIds={Object.keys(selection).filter((id) => selection[id])}
              />
            </div>
          )}
          {!!providerBatch?.domains.length && (
            providerBatch.domains.length > providerBatchLimit ? (
              <Modal open onOpenChange={() => setProviderBatch(undefined)} title="Select fewer domains"
                description={`Select up to ${providerBatchLimit} domains for each provider batch.`}>
                <Button onClick={() => setProviderBatch(undefined)}>Back to selection</Button>
              </Modal>
            ) : (
              <ProviderBatch mode={providerBatch.mode} domains={providerBatch.domains} accounts={summary?.accounts ?? []}
                onClose={() => setProviderBatch(undefined)} />
            )
          )}
        </>
      )}
      {error ? (
        <Empty title="Couldn’t load your domains" description={(error as Error).message}>
          <Button onClick={() => void queryClient.invalidateQueries({ queryKey: ['domains'] })}>
            Retry
          </Button>
        </Empty>
      ) : isPending || isPlaceholderData ? (
        <div className="table-loading" role="status" aria-label="Loading domains">
          {[1, 2, 3, 4, 5].map((i) => (
            <div className="skeleton h-9" key={i} />
          ))}
        </div>
      ) : data?.rows.length ? (
        <>
          <p className="table-scroll-hint">
            <ArrowLeftRight size={14} />
            Scroll horizontally to view all columns
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Domain portfolio table"
          >
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        aria-sort={
                          header.id === sort ||
                          (matrix && header.id === 'status' && sort === 'comparison')
                            ? direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        {header.id === 'name' ||
                        header.id === 'askingPrice' ||
                        header.id === 'expiration' ||
                        header.id === 'registrar' ||
                        header.id === 'nameservers' ||
                        header.id === 'status' ||
                        (matrix && header.id === 'status') ||
                        header.id === 'acquisitionCost' ? (
                          <button
                            className="sort-button"
                            onClick={() => {
                              const key =
                                matrix && header.id === 'status' ? 'comparison' : header.id;
                              setSort(key);
                              setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc');
                              setPage(1);
                            }}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <ArrowDownUp size={12} />
                          </button>
                        ) : providerFromLabel(header.id) ? (
                          <span className="provider-column-heading">
                            <ProviderLogo provider={providerFromLabel(header.id)!} size={22} />
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} data-selected={row.getIsSelected()}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty
          title={
            q ||
            tld ||
            registrar ||
            tag ||
            comparison ||
            listing ||
            attention ||
            expiration ||
            days ||
            month
              ? 'No domains match this view'
              : 'Make room for your next great domain'
          }
          description={
            q ||
            tld ||
            registrar ||
            tag ||
            comparison ||
            listing ||
            attention ||
            expiration ||
            days ||
            month
              ? 'Adjust the search or clear the filters to review the rest of your portfolio.'
              : 'Add a domain or import a CSV to start building your portfolio.'
          }
        >
          {(q ||
            tld ||
            registrar ||
            tag ||
            comparison ||
            listing ||
            attention ||
            expiration ||
            days) && (
            <Button
              onClick={() => {
                setQ('');
                setDebounced('');
                setTld('');
                setRegistrar('');
                setTag('');
                setComparison('');
                setListing('');
                setAttention('');
                setExpiration('');
                setDays('');
                setMonth('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </Empty>
      )}
      {data && (
        <div className="table-footer">
          <span aria-live="polite">
            {isPlaceholderData
              ? 'Loading domains…'
              : `${data.rows.length ? (data.page - 1) * data.take + 1 : 0}–${data.rows.length ? Math.min(data.page * data.take, data.total) : 0} of ${data.total.toLocaleString()} domains`}
          </span>
          {!compact && (
            <nav className="pagination" aria-label="Domain table pages">
              <label className="pagination-size">
                <span>Rows per page</span>
                <select
                  aria-label="Domains per page"
                  value={take}
                  onChange={(e) => {
                    setTake(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {[25, 50, 100, 200, 500].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pagination-pages">
                <Button
                  disabled={isPlaceholderData || page === 1}
                  onClick={() => setPage(page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </Button>
                <span>
                  Page {data.page} of {Math.max(1, Math.ceil(data.total / data.take))}
                </span>
                <Button
                  disabled={isPlaceholderData || page * data.take >= data.total}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}
      <Modal
        title={
          bulkField === 'acquisitionCost'
            ? 'Update acquisition costs'
            : bulkField === 'renewalCost'
              ? 'Update annual renewal costs'
              : bulkField === 'registrar'
                ? 'Update domain registrar'
                : bulkField === 'status'
                  ? 'Update domain status'
                  : bulkField === 'nameservers'
                    ? 'Record nameservers in Assame'
                    : 'Update internal asking prices'
        }
        description={
          bulkField === 'registrar'
            ? 'Update the recorded registrar for selected domains.'
            : bulkField === 'status'
              ? 'Update the lifecycle status for selected domains.'
              : bulkField === 'renewalCost'
                ? 'Update estimated annual renewal costs for selected domains.'
                : bulkField === 'nameservers'
                  ? 'Record nameservers for selected domains in Assame. This does not change the registrar.'
                  : 'Review exact changes before saving. These edits apply to portfolio records and are never published to marketplaces.'
        }
        wide
        open={bulk}
        onOpenChange={setBulk}
      >
        <div className="stack">
          {preview ? (
            <>
              <div className="notice notice-amber">
                <AlertTriangle size={18} />
                Review these exact changes. If any selected domain changes, you’ll need a new
                preview.
              </div>
              {bulkField === 'askingPrice' && (
                <div className="p-2.5 rounded border border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300 text-xs font-medium">
                  Provider listings are not changed by this internal edit.
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Current</th>
                      <th>
                        {bulkField === 'acquisitionCost'
                          ? 'New acquisition cost'
                          : bulkField === 'renewalCost'
                            ? 'New renewal cost'
                            : bulkField === 'registrar'
                              ? 'New registrar'
                              : bulkField === 'status'
                                ? 'New status'
                                : bulkField === 'nameservers'
                                  ? 'New nameservers'
                                  : 'New asking price'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          {bulkField === 'acquisitionCost'
                            ? formatMoney(row.acquisitionCost, row.currency)
                            : bulkField === 'renewalCost'
                              ? formatMoney(row.renewalCost, row.currency)
                              : bulkField === 'askingPrice'
                                ? formatMoney(row.askingPrice, row.currency)
                                : bulkField === 'registrar'
                                  ? row.registrar || '—'
                                  : bulkField === 'nameservers'
                                    ? row.nameservers || '—'
                                    : row.status || '—'}
                        </td>
                        <td>
                          {['acquisitionCost', 'askingPrice', 'renewalCost'].includes(bulkField)
                            ? formatMoney(preview.value ?? preview.price, row.currency)
                            : (preview.value ?? preview.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('bulk.confirm', { token: preview.token });
                    await queryClient.invalidateQueries();
                    setBulk(false);
                    setSelection({});
                    toast.success(
                      bulkField === 'acquisitionCost'
                        ? 'Acquisition costs updated and audited.'
                        : bulkField === 'renewalCost'
                          ? 'Annual renewal costs updated.'
                          : bulkField === 'registrar'
                            ? 'Domain registrars updated.'
                            : bulkField === 'status'
                              ? 'Domain statuses updated.'
                              : bulkField === 'nameservers'
                                ? 'Nameservers recorded in Assame. Update the registrar separately.'
                                : 'Internal asking prices updated; provider listings were not changed.',
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm {preview.rows.length}{' '}
                {bulkField === 'acquisitionCost'
                  ? 'acquisition cost'
                  : bulkField === 'renewalCost'
                    ? 'renewal cost'
                    : bulkField === 'askingPrice'
                      ? 'asking price'
                      : bulkField}{' '}
                changes
              </Button>
            </>
          ) : (
            <>
              {bulkField === 'nameservers' ? (
                <div className="stack gap-3">
                  <div className="flex flex-wrap items-center gap-1.5 pb-1">
                    <span className="text-xs font-semibold text-muted">Presets:</span>
                    {[
                      {
                        label: 'Namecheap BasicDNS',
                        ns: 'dns1.registrar-servers.com\ndns2.registrar-servers.com',
                      },
                      {
                        label: 'Afternic Parking',
                        ns: 'ns1.afternic.com\nns2.afternic.com',
                      },
                      {
                        label: 'Dynadot Parking',
                        ns: 'ns1.dynadot.com\nns2.dynadot.com',
                      },
                      {
                        label: 'Spaceship Parking',
                        ns: 'parking1.spaceship.com\nparking2.spaceship.com',
                      },
                      {
                        label: 'Atom Parking',
                        ns: 'ns1.atom.com\nns2.atom.com',
                      },
                      {
                        label: 'Sedo Parking',
                        ns: 'ns1.sedoparking.com\nns2.sedoparking.com',
                      },
                      {
                        label: 'Dan Parking',
                        ns: 'ns1.dan.com\nns2.dan.com',
                      },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => setBulkValue(p.ns)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <Field
                    label="Nameservers to record (one per line)"
                    hint="Pushed to Namecheap, Dynadot, and Spaceship via API for connected accounts."
                  >
                    <textarea
                      className="w-full font-mono text-xs p-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent min-h-[90px]"
                      placeholder="ns1.example.com&#10;ns2.example.com"
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                    />
                  </Field>
                </div>
              ) : bulkField === 'status' ? (
                <Field label="New domain status">
                  <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                    <option value="active">Active</option>
                    <option value="sold">Sold</option>
                    <option value="lto">Lease-to-own (LTO)</option>
                    <option value="expired">Expired</option>
                    <option value="pending">Pending</option>
                    <option value="in_escrow">In Escrow</option>
                  </select>
                </Field>
              ) : bulkField === 'registrar' ? (
                <Field label="New registrar" hint="e.g. Dynadot, Namecheap, GoDaddy, Porkbun">
                  <Input
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="Dynadot"
                  />
                </Field>
              ) : (
                <Field
                  label={
                    bulkField === 'acquisitionCost'
                      ? 'New acquisition cost'
                      : bulkField === 'renewalCost'
                        ? 'New annual renewal cost'
                        : 'New internal asking price'
                  }
                  hint="Applied in each domain’s own accounting currency."
                >
                  <Input
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </Field>
              )}

              <Button
                variant="primary"
                disabled={busy || !bulkValue.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setPreview(
                      await api('bulk.preview', {
                        ids: Object.keys(selection).filter((k) => selection[k]),
                        value: bulkValue.trim(),
                        field: bulkField,
                      }),
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Preview changes
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
