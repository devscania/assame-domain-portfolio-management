'use client';
import { useState } from 'react';
import { ProviderLabel } from './provider-label';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  CalendarClock,
  Globe2,
  History,
  MessageSquare,
  PencilLine,
  Plus,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  api,
  read,
  formatMoney,
  formatDate,
  type DomainDetail,
  type DomainRow,
  type Summary,
  type Sale,
} from './client';
import { Badge, Button, Empty, Field, Input, Modal, Skeleton } from './ui';
import { DomainForm } from './domain-forms';
import { PerformanceChart } from './charts';
import { useWorkspace } from './shell';
import { ListingPriceEditor } from './listing-price-editor';
import { financials } from '@/lib/finance';
import { isAvailableProvider, providers } from '@/integrations/catalog';
import { listingStatusLabel } from '@/integrations/listing-status';
import { ProviderAction } from './provider-action';
import { ListingStatistics, RefreshListingStatistics } from './listing-statistics';
const total = (items: { amount: string }[]) =>
  items.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
function saleFigures(sale: Sale) {
  const investment = new Decimal(sale.domain.acquisitionCost ?? 0).plus(
    total(sale.domain.expenses?.filter((e) => e.currency === sale.currency) ?? []),
  );
  const result = financials(
    sale.grossAmount,
    sale.payments.map((p) => p.amount),
    sale.commissions.map((c) => c.amount),
    investment.toString(),
    sale.status === 'completed',
    sale.payments.map((p) => p.commissionWithheld || '0'),
  );
  return {
    ...result,
    realizedProfit: new Decimal(result.realizedProfit)
      .plus(sale.status === 'completed' ? total(sale.adjustments) : 0)
      .toFixed(2),
    commission: total(sale.commissions).toFixed(2),
    investment: investment.toFixed(2),
  };
}
export function DomainDetails({ id }: { id: string }) {
  const {
    data: domain,
    isPending,
    error,
  } = useQuery({
    queryKey: ['domain', id],
    queryFn: () => read<DomainDetail>(`view=domain&id=${id}`),
  });
  const [edit, setEdit] = useState(false);
  const [saleCreate, setSaleCreate] = useState(false);
  const [reportedSale, setReportedSale] = useState<Summary['providerSales'][number]>();
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => read<Summary>('view=summary'),
  });
  const [tab, setTab] = useState('Overview');
  const [action, setAction] = useState<'expense' | 'renewal' | undefined>();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const query = useQueryClient();
  const workspace = useWorkspace();
  const canEdit = workspace.role !== 'VIEWER';
  if (isPending) return <Skeleton />;
  if (error || !domain)
    return (
      <Empty
        title="Domain unavailable"
        description={error?.message || 'This domain is not in your workspace.'}
      />
    );
  const reg = domain.registrations[0];
  const investment = new Decimal(domain.acquisitionCost).plus(
    total(domain.expenses.filter((e) => e.currency === domain.currency)),
  );
  return (
    <>
      <Link className="back-link" href="/domains">
        <ArrowLeft size={15} />
        Back to portfolio
      </Link>
      <div className="domain-detail-heading">
        <span className="detail-favicon">
          <Globe2 size={30} />
        </span>
        <div>
          <div className="flex items-center gap-3">
            <h1>{domain.name}</h1>
            <Badge tone={domain.status === 'active' ? 'green' : 'purple'}>{domain.status}</Badge>
          </div>
          <p>
            {domain.confidence} · {domain.source} source · .{domain.tld}
          </p>
        </div>
        <Button className="ml-auto" disabled={!canEdit} onClick={() => setEdit(true)}>
          <PencilLine size={15} />
          Edit domain
        </Button>
        <Button
          variant="danger"
          disabled={!canEdit || busy}
          onClick={async () => {
            if (
              !confirm(
                `Are you sure you want to delete ${domain.name}? This will remove it from your active portfolio.`,
              )
            )
              return;
            setBusy(true);
            try {
              await api('domain.delete', { id: domain.id });
              await query.invalidateQueries();
              toast.success('Domain deleted');
              router.push('/domains');
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={15} />
          Delete domain
        </Button>
        <ProviderAction domain={domain} />
        <RefreshListingStatistics domainIds={[domain.id]} />
        {!domain.sales.length && (
          <Button disabled={!canEdit} onClick={() => setSaleCreate(true)}>
            Record sale
          </Button>
        )}
      </div>
      <div className="section-tabs">
        {summary?.providerSales
          .filter((s) => s.domainName === domain.name)
          .map((s) => (
            <ProviderSaleReport
              key={s.id}
              sale={s}
              ledgerSale={summary.sales.find((item) => item.domainId === domain.id)}
              onRecord={() => {
                setReportedSale(s);
                setSaleCreate(true);
              }}
            />
          ))}
        {['Overview', 'Marketplace listings', 'Financial history', 'Notes & history'].map(
          (label) => (
            <button
              key={label}
              className={tab === label ? 'tab-active' : ''}
              onClick={() => setTab(label)}
            >
              {label}
            </button>
          ),
        )}
      </div>
      {tab === 'Overview' && (
        <>
          <div className="kpi-grid">
            <DetailKpi
              label="Internal asking price"
              value={formatMoney(domain.askingPrice, domain.currency)}
              note="Your reference price, not a valuation"
            />
            <DetailKpi
              label="Acquisition cost"
              value={formatMoney(domain.acquisitionCost, domain.currency)}
              note={formatDate(domain.acquiredAt)}
            />
            <DetailKpi
              label="Total recorded investment"
              value={formatMoney(investment.toString(), domain.currency)}
              note="Acquisition + recorded expenses"
            />
            <DetailKpi
              label="Annual renewal cost"
              value={formatMoney(reg?.renewalCost, reg?.currency)}
              note="Known cost, not an estimate"
            />
          </div>
          <div className="analytics-grid">
            <section className="card">
              <div className="card-header">
                <h3>Registration details</h3>
                <CalendarClock size={18} className="muted" />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Registrar</dt>
                  <dd>
                    <ProviderLabel name={reg?.registrar || 'Unknown'} />
                  </dd>
                </div>
                <div>
                  <dt>Registered on</dt>
                  <dd>{formatDate(reg?.registeredAt)}</dd>
                </div>
                <div>
                  <dt>Expires on</dt>
                  <dd>{formatDate(reg?.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Auto-renew at registrar</dt>
                  <dd>
                    {reg?.autoRenew === null || reg?.autoRenew === undefined
                      ? 'Not verified'
                      : reg.autoRenew
                        ? 'Enabled'
                        : 'Disabled'}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {reg?.source === 'public-rdap'
                      ? 'Public registry (RDAP)'
                      : reg?.source || 'manual'}
                  </dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd>
                    {reg?.verifiedAt && reg.source !== 'manual-nameservers'
                      ? formatDate(reg.verifiedAt)
                      : 'Not provider-verified'}
                  </dd>
                </div>
              </dl>
              <div className="card-action">
                <Button disabled={!reg || !canEdit} onClick={() => setAction('renewal')}>
                  Confirm manual renewal
                </Button>
              </div>
            </section>
            <section className="card">
              <div className="card-header">
                <h3>Nameservers & ownership</h3>
                <ShieldCheck size={18} className="text-teal-600" />
              </div>
              <div className="settings-form">
                {reg?.nameservers.length ? (
                  reg.nameservers.map((ns) => (
                    <code className="nameserver" key={ns}>
                      {ns}
                    </code>
                  ))
                ) : (
                  <p className="muted text-sm">Nameservers have not been retrieved.</p>
                )}
                <ProviderAction domain={domain} action="changeNameservers" />
                <p className="muted text-sm">
                  Nameservers can be retrieved from your registrar or a public lookup. Changes
                  require a supported registrar connection for this domain.
                </p>
                <div className="flex flex-wrap gap-2">
                  {domain.tags.map((t) => (
                    <Badge key={t.tag.id}>{t.tag.name}</Badge>
                  ))}
                  {!domain.tags.length && (
                    <span className="muted text-sm">No tags yet. Add them with Edit domain.</span>
                  )}
                </div>
              </div>
            </section>
          </div>
        </>
      )}
      {tab === 'Marketplace listings' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Independent marketplace prices</h3>
              <p>Preview and confirm each provider-specific BIN price change.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>
                {workspace.pricePublishingEnabled ? 'Publishing enabled' : 'Publishing off'}
              </Badge>
            </div>
          </div>
          {domain.listings.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Marketplace</th>
                    <th>BIN price</th>
                    <th>Minimum offer</th>
                    <th>Status</th>
                    <th>LTO</th>
                    <th>Views / leads</th>
                    <th>Verified</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.listings.map((listing) => (
                    <tr key={listing.id}>
                      <td className="capitalize">
                        <strong>
                          <ProviderLabel name={listing.marketplace}>
                            {listing.marketplace === 'spaceship'
                              ? 'SellerHub'
                              : listing.marketplace}
                          </ProviderLabel>
                        </strong>
                        <small>{listing.source}</small>
                      </td>
                      <td>
                        {formatMoney(listing.binPrice, listing.currency)}
                        <ListingPriceEditor
                          listing={listing}
                          domainName={domain.name}
                          domainId={domain.id}
                          askingPrice={domain.askingPrice}
                        />
                      </td>
                      <td>{formatMoney(listing.minOffer, listing.currency)}</td>
                      <td>
                        <Badge tone={listing.stale ? 'amber' : 'green'}>
                          {listing.stale ? 'Stale' : listingStatusLabel(listing.marketplace, listing.status)}
                        </Badge>
                      </td>
                      <td>
                        {listing.lto
                          ? listing.lto.enabled
                            ? `Enabled · ${listing.lto.maxPeriod || 'provider-defined'} months`
                            : 'Disabled'
                          : 'Unavailable'}
                      </td>
                      <td>
                        <ListingStatistics listings={[listing]} />
                      </td>
                      <td>
                        {listing.verifiedAt ? formatDate(listing.verifiedAt) : 'Not API verified'}
                      </td>
                      <td>
                        {isAvailableProvider(listing.marketplace) &&
                        providers[listing.marketplace].capabilities.removeListings &&
                        listing.providerAccountId ? (
                          <ProviderAction
                            domain={domain}
                            action="removeListing"
                            provider={listing.marketplace}
                            listingAccountId={listing.providerAccountId}
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            disabled
                            title="Delist at the provider; Assame does not support remote delisting yet."
                          >
                            <Trash2 size={13} />
                            Delisting unavailable
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="A marketplace of possibilities"
              description="Connect a supported provider to retrieve this domain’s listings."
            />
          )}
          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-sm font-semibold mb-2">
              Marketplace verification & important guidance
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {domain.listings.map((l) => {
                const prov = l.marketplace;
                const isDynadot = prov === 'dynadot';
                const isPending = [
                  'PENDING',
                  'pending',
                  'unverified',
                  'requires_verification',
                  'review',
                ].includes(l.status);
                return (
                  <div
                    key={l.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <strong className="capitalize text-xs font-semibold">
                          <ProviderLabel name={prov}>
                            {prov === 'spaceship' ? 'SellerHub' : prov}
                          </ProviderLabel>
                        </strong>
                        <Badge tone={isPending ? 'amber' : 'green'}>{listingStatusLabel(l.marketplace, l.status)}</Badge>
                      </div>
                      <span className="text-[11px] text-muted">
                        {l.verifiedAt
                          ? `Verified ${formatDate(l.verifiedAt)}`
                          : 'Awaiting verification'}
                      </span>
                    </div>

                    {isDynadot && (
                      <div className="text-xs space-y-1 text-slate-700 dark:text-slate-300">
                        <p>
                          <strong>Domain lock requirement:</strong> Dynadot requires your domain to
                          be <em>unlocked</em> before updating marketplace pricing or sales status.
                        </p>
                        <p className="text-muted">
                          If updating the BIN price reports &quot;Please unlock your domain
                          firstly&quot;, log in to Dynadot &gt;{' '}
                          <strong>My Domains &gt; Manage Domains</strong>, select{' '}
                          <strong>{domain.name}</strong>, and choose <strong>Unlock Domains</strong>
                          .
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {tab === 'Financial history' && (
        <>
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <h3>Recorded holding expenses</h3>
                <p>Financial history is preserved separately from provider inventory.</p>
              </div>
              <Button disabled={!canEdit} onClick={() => setAction('expense')}>
                <Plus size={15} />
                Add expense
              </Button>
            </div>
            {domain.expenses.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domain.expenses.map((e, i) => (
                      <tr key={i}>
                        <td>{formatDate(e.occurredAt)}</td>
                        <td>{e.category}</td>
                        <td>{formatMoney(e.amount, e.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted p-6">No holding expenses recorded.</p>
            )}
          </div>
          <div className="card">
            <div className="card-header">
              <h3>Sales & installment agreements</h3>
              <Link href="/sales" className="text-link">
                Manage finances
                <ArrowUpRight size={14} />
              </Link>
            </div>
            {domain.sales.length ? (
              domain.sales.map((s) => (
                <div key={s.id} className="settings-form">
                  <strong>
                    {formatMoney(s.grossAmount, s.currency)} · {s.kind}
                  </strong>
                  <p>
                    {formatMoney(total(s.payments).toString(), s.currency)} collected ·{' '}
                    {s.installments.length} scheduled installments
                  </p>
                </div>
              ))
            ) : (
              <p className="muted p-6">No sales recorded for this domain.</p>
            )}
          </div>
        </>
      )}
      {tab === 'Notes & history' && (
        <div className="analytics-grid">
          <section className="card">
            <div className="card-header">
              <h3>Domain notes</h3>
              <MessageSquare size={18} className="muted" />
            </div>
            <div className="settings-form">
              {domain.notes.map((note) => (
                <div className="domain-note" key={note.id}>
                  <p>{note.body}</p>
                  <small>{formatDate(note.createdAt)}</small>
                </div>
              ))}
              <form
                method="post"
                className="stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const body = new FormData(form).get('body');
                  setBusy(true);
                  try {
                    await api('note.create', { domainId: id, body });
                    await query.invalidateQueries();
                    form.reset();
                    toast.success('Note saved');
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <textarea
                  name="body"
                  aria-label="Domain note"
                  required
                  maxLength={5000}
                  placeholder="Add some context to this domain…"
                />
                <Button disabled={busy || !canEdit} variant="primary">
                  Save note
                </Button>
              </form>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h3>Price history</h3>
              <History size={18} className="muted" />
            </div>
            {domain.prices.length ? (
              <div className="price-history">
                {domain.prices.map((p) => (
                  <div key={p.id}>
                    <span className="activity-dot">
                      <History size={13} />
                    </span>
                    <div>
                      <strong>{p.marketplace}</strong>
                      <p>
                        {formatMoney(p.previousPrice, p.currency)} →{' '}
                        {formatMoney(p.price, p.currency)}
                      </p>
                      <small>
                        {formatDate(p.createdAt)} · {p.source}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted p-6">Price changes will appear here.</p>
            )}
          </section>
        </div>
      )}
      <DomainForm
        key={`${id}-${edit}-${domain.updatedAt}`}
        domain={domain}
        open={edit}
        onOpenChange={setEdit}
      />
      <SaleForm
        key={`sale-${domain.id}-${saleCreate}`}
        open={saleCreate}
        onOpenChange={setSaleCreate}
        defaultDomain={domain}
        reported={reportedSale}
      />
      <Modal
        title={action === 'renewal' ? 'Confirm a completed renewal' : 'Record an expense'}
        description={
          action === 'renewal'
            ? 'Record a renewal you already paid for at the registrar. This does not perform a remote renewal.'
            : 'Add an actual holding cost in this domain’s currency.'
        }
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(undefined);
        }}
      >
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const values = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await api(
                action === 'renewal' ? 'renewal.confirm' : 'expense.create',
                action === 'renewal'
                  ? { ...values, registrationId: reg?.id }
                  : { ...values, domainId: id },
              );
              await query.invalidateQueries();
              setAction(undefined);
              toast.success('Financial record saved');
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={`Amount (${action === 'renewal' ? reg?.currency : domain.currency})`}>
            <Input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={action === 'renewal' ? reg?.renewalCost || '' : ''}
            />
          </Field>
          {action === 'renewal' ? (
            <Field label="New expiration date">
              <Input name="expiresAt" type="date" required />
            </Field>
          ) : (
            <Field label="Expense category">
              <Input name="category" required placeholder="Brokerage, legal, parking…" />
            </Field>
          )}
          <Button disabled={busy} variant="primary">
            Save record
          </Button>
        </form>
      </Modal>
    </>
  );
}
function DetailKpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card kpi-card">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Sales({ data }: { data: Summary }) {
  const [create, setCreate] = useState(false);
  const [payment, setPayment] = useState<Sale>();
  const [detailSelection, setDetail] = useState<Sale>();
  const detail = data.sales.find((s) => s.id === detailSelection?.id) ?? detailSelection;
  const [editSale, setEditSale] = useState(false);
  const [saleGross, setSaleGross] = useState('');
  const [saleMarketplace, setSaleMarketplace] = useState('');
  const [saleCommission, setSaleCommission] = useState('');
  const [adjust, setAdjust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<Summary['providerSales'][number]>();
  const query = useQueryClient();
  const workspace = useWorkspace();
  return (
    <>
      <div className="kpi-grid">
        <DetailKpi
          label="Signed sale agreements"
          value={formatMoney(data.gross, data.currency)}
          note="Contracted amount, not collected revenue"
        />
        <DetailKpi
          label="Recorded cash receipts"
          value={formatMoney(data.collected, data.currency)}
          note="Received payments only"
        />
        <DetailKpi
          label="Total portfolio investment"
          value={formatMoney(data.totalInvestment, data.currency)}
          note={`Acquisitions (${formatMoney(data.investment, data.currency)}) + renewals (${formatMoney(data.renewals, data.currency)}) + holding expenses`}
        />
        <DetailKpi
          label={
            new Decimal(data.netReturn || '0').gte(0)
              ? 'Net portfolio profit'
              : 'Net portfolio loss'
          }
          value={
            new Decimal(data.netReturn || '0').gte(0)
              ? `+${formatMoney(data.netReturn, data.currency)}`
              : `-${formatMoney(new Decimal(data.netReturn || '0').abs().toString(), data.currency)}`
          }
          note={`${formatMoney(data.collected, data.currency)} collected less ${formatMoney(data.totalInvestment, data.currency)} invested`}
        />
      </div>
      {new Decimal(data.undatedCash || '0').gt(0) && (
        <div className="notice notice-amber mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <span>
              <strong>{formatMoney(data.undatedCash, data.currency)}</strong> in receipts has no
              recorded payout date and is excluded from the monthly cash-flow chart.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-semibold">Set payout dates:</span>
            {data.sales
              .flatMap((s) =>
                s.payments.filter((p) => !p.receivedAt).map((p) => ({ sale: s, payment: p })),
              )
              .map(({ sale, payment: p }) => (
                <PaymentDateEditor
                  key={p.id}
                  paymentId={p.id}
                  initialDate={p.receivedAt?.slice(0, 10)}
                  initialAmount={p.amount}
                  currency={sale.currency}
                  label={`${sale.domain.name} (${formatMoney(p.amount, sale.currency)})`}
                  variant="secondary"
                  compact
                />
              ))}
          </div>
        </div>
      )}
      <div className="card mb-6">
        <div className="card-header">
          <div>
            <h3>Cash flow, with context</h3>
            <p>Received payments compared with acquisition spending · {data.currency}</p>
          </div>
          <Badge>6 months</Badge>
        </div>
        <PerformanceChart data={data.monthly} currency={data.currency} />
      </div>
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Your sales ledger</h3>
            <p>Installment agreements remain separate from cash collection.</p>
          </div>
          <Button
            variant="primary"
            disabled={workspace.role === 'VIEWER'}
            onClick={() => {
              setReported(undefined);
              setCreate(true);
            }}
          >
            <Plus size={16} />
            Record sale
          </Button>
        </div>
        {data.sales.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Domain / marketplace</th>
                  <th>Signed agreement</th>
                  <th>Collected</th>
                  <th>Balance</th>
                  <th>Net proceeds</th>
                  <th>Realized profit</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Payout date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.sales.map((sale) => {
                  const paid = total(sale.payments);
                  const figures = saleFigures(sale);
                  return (
                    <tr key={sale.id}>
                      <td>
                        <button
                          className="domain-name"
                          onClick={() => {
                            setDetail(sale);
                            setAdjust(false);
                          }}
                        >
                          {sale.domain.name}
                        </button>
                        <small>
                          {sale.marketplace} · {formatDate(sale.soldAt)}
                        </small>
                      </td>
                      <td>{formatMoney(sale.grossAmount, sale.currency)}</td>
                      <td className="text-teal-600 font-semibold">
                        {formatMoney(paid.toString(), sale.currency)}
                      </td>
                      <td>{formatMoney(figures.unpaid, sale.currency)}</td>
                      <td>
                        {sale.status === 'completed'
                          ? formatMoney(figures.net, sale.currency)
                          : 'Pending reconciliation'}
                      </td>
                      <td>
                        {sale.status === 'completed'
                          ? formatMoney(figures.realizedProfit, sale.currency)
                          : 'Not realized'}
                      </td>
                      <td>
                        <Badge tone={sale.kind === 'lto' ? 'purple' : 'neutral'}>
                          {sale.kind === 'lto'
                            ? `${sale.installments.length} installments`
                            : 'Outright'}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={sale.status === 'completed' ? 'green' : 'amber'}>
                          {sale.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="stack gap-1">
                          {sale.payments.length ? (
                            sale.payments.map((p) =>
                              p.receivedAt ? (
                                <div key={p.id} className="flex items-center gap-1.5 text-xs">
                                  <span>{formatDate(p.receivedAt)}</span>
                                  {workspace.role !== 'VIEWER' && (
                                    <PaymentDateEditor
                                      paymentId={p.id}
                                      initialDate={p.receivedAt.slice(0, 10)}
                                      initialAmount={p.amount}
                                      currency={sale.currency}
                                      label="Edit"
                                      variant="ghost"
                                      compact
                                    />
                                  )}
                                </div>
                              ) : (
                                <div key={p.id} className="flex items-center gap-1.5">
                                  <Badge tone="amber">Undated</Badge>
                                  {workspace.role !== 'VIEWER' && (
                                    <PaymentDateEditor
                                      paymentId={p.id}
                                      initialAmount={p.amount}
                                      currency={sale.currency}
                                      label="Set payout date"
                                      variant="secondary"
                                      compact
                                    />
                                  )}
                                </div>
                              ),
                            )
                          ) : (
                            <span className="muted text-xs">No payments</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title={`Edit sale for ${sale.domain.name}`}
                            onClick={() => {
                              setDetail(sale);
                              setSaleGross(sale.grossAmount);
                              setSaleMarketplace(sale.marketplace);
                              setSaleCommission(total(sale.commissions).toString());
                              setEditSale(true);
                              setAdjust(false);
                            }}
                          >
                            <PencilLine size={13} />
                          </Button>
                          <Button
                            disabled={
                              workspace.role === 'VIEWER' || new Decimal(figures.unpaid).lte(0)
                            }
                            onClick={() => setPayment(sale)}
                          >
                            <Plus size={13} />
                            Payment
                          </Button>
                          {workspace.role !== 'VIEWER' && (
                            <Button
                              variant="ghost"
                              title={`Delete recorded sale for ${sale.domain.name}`}
                              onClick={async () => {
                                if (
                                  !confirm(
                                    `Delete recorded sale for ${sale.domain.name}? This will remove recorded payments and restore domain status to active.`,
                                  )
                                )
                                  return;
                                try {
                                  await api('sale.delete', { saleId: sale.id });
                                  await query.invalidateQueries();
                                  toast.success(`Sale for ${sale.domain.name} deleted`);
                                } catch (err) {
                                  toast.error((err as Error).message);
                                }
                              }}
                            >
                              <Trash2 size={13} className="text-rose-500" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your next sale starts a new chapter"
            description="Record a signed sale, then add payments as they are actually received."
          />
        )}
      </div>
      <div className="notice mt-6">
        <Wallet size={18} />
        <p>
          Commission obligations recorded: {formatMoney(data.commission, data.currency)}. Holding
          expenses: {formatMoney(data.expenses, data.currency)}. Totals include {data.currency}{' '}
          only; no exchange-rate conversion. Sales list shows the latest 100 records.
        </p>
      </div>
      <section className="card mt-6">
        <div className="card-header">
          <div>
            <h3>Provider-reported sales</h3>
            <p>
              Review marketplace sales and record the payouts you’ve received.
            </p>
          </div>
        </div>
        {data.providerSales.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Provider</th>
                  <th>Reported sale price</th>
                  <th>Status / type</th>
                  <th>Reported installments</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {data.providerSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <ProviderSaleReport
                        sale={sale}
                        ledgerSale={data.sales.find((item) => item.domainId === sale.domainId)}
                        onRecord={() => {
                          setReported(sale);
                          setCreate(true);
                        }}
                      />
                    </td>
                    <td>
                      {sale.account.providerId}
                      <small>{sale.account.label}</small>
                    </td>
                    <td>{formatMoney(sale.amount, sale.currency)}</td>
                    <td>
                      {sale.status}
                      <small>{sale.kind}</small>
                    </td>
                    <td>
                      {sale.installments
                        ? `${sale.installmentsPaid ?? '—'} / ${sale.installments}`
                        : 'Unavailable'}
                    </td>
                    <td>
                      {formatDate(sale.observedAt)}
                      {!sale.hasLedgerSale && sale.domainId && workspace.role !== 'VIEWER' && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setReported(sale);
                            setCreate(true);
                          }}
                        >
                          Record sale and payout
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No verified provider sales yet"
            description="Sync Afternic or SellerHub to retrieve reported sales. Reported agreements never become collected cash automatically."
          />
        )}
      </section>
      <SaleForm
        key={`create-${create}-${reported?.id || 'manual'}`}
        open={create}
        onOpenChange={setCreate}
        reported={reported}
      />
      <Modal
        title="Record a received payment"
        description={`${payment?.domain.name || ''} · This records money actually collected.`}
        open={!!payment}
        onOpenChange={(v) => {
          if (!v) setPayment(undefined);
        }}
      >
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const values = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await api('payment.create', {
                ...values,
                receivedAt: values.receivedAt || null,
                saleId: payment?.id,
              });
              await query.invalidateQueries();
              setPayment(undefined);
              toast.success('Payment recorded');
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label={`Amount received (${payment?.currency})`}
            hint="Net payout from your statement"
          >
            <Input name="amount" required inputMode="decimal" />
          </Field>
          <Field
            label="Payment reference"
            hint="Use a unique reference to prevent duplicate payments."
          >
            <Input name="reference" required maxLength={100} />
          </Field>
          <Field
            label="Received on"
            hint="Leave blank if unknown; undated receipts are excluded from monthly charts."
          >
            <Input
              name="receivedAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Button disabled={busy} variant="primary">
            Record payment
          </Button>
        </form>
      </Modal>
      <Modal
        title={detail?.domain.name || 'Sale details'}
        description="Agreement schedule and received payment history."
        wide
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) {
            setDetail(undefined);
            setEditSale(false);
          }
        }}
      >
        <div className="stack">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Platform:</span>
              <strong className="text-sm font-semibold">{detail?.marketplace}</strong>
              <Badge tone={detail?.status === 'completed' ? 'green' : 'amber'}>
                {detail?.status}
              </Badge>
            </div>
            {workspace.role !== 'VIEWER' && detail && (
              <Button
                variant="secondary"
                className="text-xs h-7 px-2.5"
                onClick={() => {
                  setSaleGross(detail.grossAmount);
                  setSaleMarketplace(detail.marketplace);
                  setSaleCommission(total(detail.commissions).toString());
                  setEditSale(!editSale);
                }}
              >
                <PencilLine size={13} />
                {editSale ? 'Cancel editing' : 'Edit sale agreement'}
              </Button>
            )}
          </div>

          {editSale && detail && (
            <form
              method="post"
              className="p-3.5 rounded-lg border border-teal-500/30 bg-teal-50/50 dark:bg-teal-950/20 stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api('sale.update', {
                    saleId: detail.id,
                    grossAmount: Number(saleGross).toFixed(2),
                    marketplace: saleMarketplace,
                    commission: Number(saleCommission || 0).toFixed(2),
                  });
                  await query.invalidateQueries();
                  setEditSale(false);
                  toast.success('Sale agreement updated');
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <strong className="text-xs font-semibold text-teal-800 dark:text-teal-200">
                Edit sale agreement
              </strong>
              <div className="form-grid">
                <Field label={`Sale price (${detail.currency})`} hint="Gross sale price">
                  <Input
                    required
                    inputMode="decimal"
                    value={saleGross}
                    onChange={(e) => setSaleGross(e.target.value)}
                  />
                </Field>
                <Field label="Marketplace / Platform">
                  <Input
                    required
                    value={saleMarketplace}
                    onChange={(e) => setSaleMarketplace(e.target.value)}
                  />
                </Field>
                <Field label="Total commission">
                  <Input
                    inputMode="decimal"
                    value={saleCommission}
                    onChange={(e) => setSaleCommission(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setEditSale(false)}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          )}

          <div className="summary-strip">
            <div>
              Agreement<strong>{formatMoney(detail?.grossAmount, detail?.currency)}</strong>
            </div>
            <div>
              Collected
              <strong>
                {formatMoney(detail ? total(detail.payments).toString() : '0', detail?.currency)}
              </strong>
            </div>
            <div>
              Total commission
              <strong>
                {formatMoney(detail ? saleFigures(detail).commission : '0', detail?.currency)}
              </strong>
            </div>
            <div>
              Balance to reconcile
              <strong>
                {formatMoney(detail ? saleFigures(detail).unpaid : '0', detail?.currency)}
              </strong>
            </div>
            <div>
              Realized profit
              <strong>
                {detail?.status === 'completed'
                  ? formatMoney(saleFigures(detail).realizedProfit, detail.currency)
                  : 'Not realized'}
              </strong>
            </div>
          </div>
          <h4>Installment schedule</h4>
          <div className="table-scroll max-h-60">
            <table>
              <thead>
                <tr>
                  <th>Installment</th>
                  <th>Due date</th>
                  <th>Scheduled amount</th>
                </tr>
              </thead>
              <tbody>
                {detail?.installments.map((i) => (
                  <tr key={i.sequence}>
                    <td>#{i.sequence}</td>
                    <td>{formatDate(i.dueAt)}</td>
                    <td>{formatMoney(i.amount, detail.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Received payments</h4>
          {detail?.payments.map((p) => (
            <div className="finance-line" key={p.id}>
              <div className="flex flex-col gap-1 min-w-0 pr-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {p.reference || 'Direct payout'}
                  </span>
                  {p.receivedAt ? (
                    <Badge tone="neutral">{formatDate(p.receivedAt)}</Badge>
                  ) : (
                    <Badge tone="amber">Undated payout</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <strong className="text-sm font-semibold">
                  {formatMoney(p.amount, detail.currency)}
                </strong>
                <PaymentDateEditor
                  paymentId={p.id}
                  initialDate={p.receivedAt?.slice(0, 10)}
                  initialAmount={p.amount}
                  currency={detail?.currency}
                  label={p.receivedAt ? 'Edit payout' : 'Set received date'}
                  variant={p.receivedAt ? 'ghost' : 'secondary'}
                  compact
                />
              </div>
            </div>
          ))}
          {!detail?.payments.length && <p className="muted text-sm">No payments received yet.</p>}
          <h4>Manual adjustments</h4>
          {detail?.adjustments.map((a, i) => (
            <div className="finance-line" key={i}>
              <span>{a.reason}</span>
              <strong>{formatMoney(a.amount, detail.currency)}</strong>
            </div>
          ))}
          {adjust ? (
            <form
              method="post"
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const values = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  await api('adjustment.create', { ...values, saleId: detail?.id });
                  await query.invalidateQueries();
                  setDetail(undefined);
                  toast.success('Adjustment recorded');
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <Field label="Adjustment amount (signed)">
                <Input name="amount" required inputMode="decimal" placeholder="e.g. -25 or 50" />
              </Field>
              <Button variant="primary">Save adjustment</Button>
            </form>
          ) : (
            <Button onClick={() => setAdjust(true)} disabled={workspace.role === 'VIEWER'}>
              Add financial adjustment
            </Button>
          )}
          {workspace.role !== 'VIEWER' && detail && (
            <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <span className="text-xs text-muted">Test agreement or mistake?</span>
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !confirm(
                      `Are you sure you want to delete this recorded sale for ${detail.domain.name}? This will remove associated payment records and restore domain status to active.`,
                    )
                  )
                    return;
                  try {
                    await api('sale.delete', { saleId: detail.id });
                    await query.invalidateQueries();
                    setDetail(undefined);
                    toast.success(`Sale deleted and ${detail.domain.name} restored to active`);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <Trash2 size={13} />
                Delete recorded sale
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
function ProviderSaleReport({
  sale,
  ledgerSale,
  onRecord,
}: {
  sale: Summary['providerSales'][number];
  ledgerSale?: Sale;
  onRecord: () => void;
}) {
  const [open, setOpen] = useState(false);
  const workspace = useWorkspace();
  const expectedNet =
    sale.commissionAmount !== null ? new Decimal(sale.amount).minus(sale.commissionAmount) : null;
  const expectedProfit =
    expectedNet !== null && sale.recordedInvestment !== null
      ? expectedNet.minus(sale.recordedInvestment)
      : null;
  return (
    <>
      <Button
        variant="ghost"
        className="domain-name"
        onClick={() => setOpen(true)}
        aria-label={`View reported sale for ${sale.domainName}`}
      >
        {sale.domainName}
        {sale.kind === 'LEASED' ? ' · LTO' : ''}
      </Button>
      {open && (
        <Modal
          title={`${sale.domainName} · provider sale`}
          description={`${sale.account.label} · Last checked ${formatDate(sale.observedAt)}`}
          open={open}
          onOpenChange={setOpen}
          wide
        >
          <div className="kpi-grid">
            <DetailKpi
              label="Signed agreement"
              value={formatMoney(sale.amount, sale.currency)}
              note="Contract value, not collected cash"
            />
            <DetailKpi
              label="Reported commission"
              value={formatMoney(sale.commissionAmount, sale.currency)}
              note="Provider-reported agreement commission"
            />
            <DetailKpi
              label="Expected net proceeds"
              value={formatMoney(expectedNet?.toFixed(2), sale.currency)}
              note="Agreement less reported commission"
            />
            <DetailKpi
              label="Expected profit"
              value={formatMoney(expectedProfit?.toFixed(2), sale.currency)}
              note="Less recorded acquisition/holding costs; future costs excluded"
            />
          </div>
          <div className="stack">
            <p>
              <strong>Provider state:</strong> {sale.status} · {sale.kind}
            </p>
            <p>
              <strong>Reported installments paid:</strong> {sale.installmentsPaid ?? 'Unknown'} /{' '}
              {sale.installments ?? 'Unknown'}
            </p>
            <p>
              <strong>Buyer installment:</strong>{' '}
              {formatMoney(sale.installmentAmount, sale.currency)} · <strong>Next buyer payment:</strong>{' '}
              {formatDate(sale.nextInstallmentAt)}
            </p>
            <p>
              <strong>Recorded cash receipts:</strong>{' '}
              {ledgerSale?.payments.length
                ? formatMoney(total(ledgerSale.payments).toFixed(2), sale.currency)
                : 'Not reconciled'}
            </p>
            <p className="notice">
              Use the amount and received date on your seller payout statement to record cash.
              The buyer’s installment date and your payout date can differ.
            </p>
            <Button
              disabled={workspace.role === 'VIEWER' || sale.hasLedgerSale || !sale.domainId}
              onClick={() => {
                setOpen(false);
                onRecord();
              }}
            >
              {sale.hasLedgerSale
                ? 'Agreement already recorded'
                : 'Record sale and payout'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function PaymentDateEditor({
  paymentId,
  initialDate = '',
  initialAmount = '',
  currency = 'USD',
  label = 'Set received date',
  variant = 'ghost',
  compact = false,
}: {
  paymentId: string;
  initialDate?: string;
  initialAmount?: string;
  currency?: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [amount, setAmount] = useState(initialAmount);
  const workspace = useWorkspace();
  const query = useQueryClient();
  return (
    <>
      <Button
        variant={variant}
        disabled={workspace.role === 'VIEWER'}
        onClick={() => {
          setDate(initialDate || new Date().toISOString().slice(0, 10));
          setAmount(initialAmount);
          setOpen(true);
        }}
        className={compact ? 'text-xs py-1 px-2 h-auto' : undefined}
      >
        <Calendar size={13} />
        {label}
      </Button>
      {open && (
        <Modal
          title="Edit payout & collected cash"
          description="Update the amount received and payout date."
          open={open}
          onOpenChange={setOpen}
        >
          <form
            method="post"
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                if (amount) {
                  await api('payment.update', {
                    paymentId,
                    amount,
                    receivedAt: date || null,
                  });
                } else {
                  await api('payment.date', { paymentId, receivedAt: date });
                }
                await query.invalidateQueries();
                setOpen(false);
                toast.success('Payout record updated');
              } catch (error) {
                toast.error((error as Error).message);
              }
            }}
          >
            <Field label={`Collected amount (${currency})`} hint="Actual net cash received">
              <Input
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Actual received date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Button variant="primary">Save payment changes</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function SaleForm({
  open,
  onOpenChange,
  defaultDomain,
  reported,
}: {
  open: boolean;
  onOpenChange(value: boolean): void;
  defaultDomain?: Pick<DomainRow, 'id' | 'name' | 'currency'>;
  reported?: Summary['providerSales'][number];
}) {
  const [search, setSearch] = useState(defaultDomain?.name || reported?.domainName || '');
  const [selectedDomain, setSelectedDomain] = useState(
    defaultDomain?.id || reported?.domainId || '',
  );
  const [grossAmount, setGrossAmount] = useState(reported?.amount || '');
  const [commission, setCommission] = useState(reported?.commissionAmount || '0');
  const [marketplace, setMarketplace] = useState(reported?.account.providerId || 'Dynadot');
  const [soldAt, setSoldAt] = useState(
    reported?.soldAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  );
  const [count, setCount] = useState(
    reported?.kind === 'LEASED' ? String(reported.installments || '') : '1',
  );
  const [payout, setPayout] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useQueryClient();
  const workspace = useWorkspace();
  const { data } = useQuery({
    queryKey: ['sale-domain-options', search],
    queryFn: () =>
      read<{ rows: DomainRow[] }>(
        `view=domains&status=active&take=50&q=${encodeURIComponent(search)}`,
      ),
    enabled: open,
  });
  const initialDomain = defaultDomain ?? (reported?.domainId
    ? { id: reported.domainId, name: reported.domainName, currency: reported.currency }
    : undefined);
  const selectedRow = data?.rows.find((row) => row.id === selectedDomain);
  const fallbackDomain = initialDomain?.id === selectedDomain ? initialDomain : undefined;
  const currency = reported?.currency ?? selectedRow?.currency ?? fallbackDomain?.currency ?? workspace.currency;

  const grossNum = Number(grossAmount) || 0;
  const commNum = Number(commission) || 0;
  const netNum = Math.max(0, grossNum - commNum);

  return (
    <Modal
      title={reported?.kind === 'LEASED' ? 'Record a lease-to-own sale' : 'Record a domain sale'}
      description="Record a sold domain and cash received. Financial metrics and P&L update automatically."
      open={open}
      onOpenChange={onOpenChange}
    >
      <form
        method="post"
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selectedDomain) {
            toast.error('Please select a domain');
            return;
          }
          if (!payout.trim() && receivedAt) {
            toast.error('Enter the net payout before adding a payment date.');
            return;
          }
          setBusy(true);
          try {
            await api('sale.create', {
              domainId: selectedDomain,
              marketplace,
              grossAmount: grossAmount.trim(),
              commission: commission.trim() || '0',
              currency,
              count: Number(count),
              soldAt,
              initialPayment: payout.trim()
                ? {
                    amount: payout.trim(),
                    receivedAt: receivedAt || null,
                    reference: `${marketplace} sale payout`,
                  }
                : undefined,
            });
            await query.invalidateQueries();
            onOpenChange(false);
            toast.success('Sale successfully recorded');
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Find domain">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedDomain('');
            }}
            placeholder="Search domain name..."
          />
        </Field>
        <Field label="Domain">
          <select
            name="domainId"
            required
            className="mt-1"
            value={selectedDomain}
            onChange={(e) => setSelectedDomain(e.target.value)}
          >
            <option value="">Select a domain</option>
            {fallbackDomain && !selectedRow && (
              <option value={fallbackDomain.id}>{fallbackDomain.name} ({fallbackDomain.currency})</option>
            )}
            {data?.rows.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name} ({d.currency})
              </option>
            ))}
          </select>
        </Field>

        <div className="form-grid">
          <Field label="Gross agreement amount">
            <Input
              required
              inputMode="decimal"
              placeholder="e.g. 1000"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
            />
          </Field>
          <Field label="Marketplace">
            <Input
              required
              placeholder="Dynadot, Afternic, Spaceship, Atom, Direct..."
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
            />
          </Field>
          <Field label="Total commission">
            <Input
              inputMode="decimal"
              placeholder="e.g. 100 (or 0 if none)"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </Field>
          <Field label="Agreement date">
            <Input
              type="date"
              required
              value={soldAt}
              onChange={(e) => setSoldAt(e.target.value)}
            />
          </Field>
        </div>

        <p className="muted text-xs">
          Net agreement value after commission: {formatMoney(netNum.toFixed(2), currency)}
          . Enter a payout only if it has been received.
        </p>
        <div className="form-grid">
          <Field
            label="Net payout already received (optional)"
            hint="Enter one net payout from your statement. You can add additional payouts after saving."
          >
            <Input value={payout} onChange={(e) => setPayout(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Payment received date (optional)">
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </Field>
          <Field label="Installments (1 = outright)">
            <Input
              type="number"
              min={1}
              max={120}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
        </div>

        <div className="dialog-actions">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? 'Recording sale…' : 'Record agreement'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
