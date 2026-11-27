'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, read, formatMoney, type Listing } from './client';
import { Button, Input, Modal, Badge } from './ui';
import { useWorkspace } from './shell';
import { ProviderAction } from './provider-action';
import { isAvailableProvider, providers } from '@/integrations/catalog';
type Preview = {
  id: string;
  domainName: string;
  provider: string;
  oldPrice: string | null;
  newPrice: string;
  currency: string;
};
type Outcome = { status: string; error: string | null; newPrice: string; currency: string };
type PreviewGroup = {
  newPrice: string;
  currency: string;
  previews: { provider: string; preview: Preview | null; reason: string | null }[];
};
type ConfirmedChange = { changeId: string; jobId: string };
export function ListingPriceEditor({
  listing,
  domainName,
  domainId,
  askingPrice,
}: {
  listing: Listing;
  domainName: string;
  domainId?: string;
  askingPrice?: string | null;
}) {
  const workspace = useWorkspace();
  const cache = useQueryClient();
  const targetDomainId = domainId || listing.domainId;
  const provider = isAvailableProvider(listing.marketplace) ? listing.marketplace : undefined;
  const removalProvider = provider && providers[provider].capabilities.removeListings ? provider : null;
  const canOpenRemoval = removalProvider && targetDomainId && listing.providerAccountId;
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(listing.binPrice || '');
  const [syncAll, setSyncAll] = useState(false);
  const [preview, setPreview] = useState<PreviewGroup>();
  const [changes, setChanges] = useState<(ConfirmedChange & { provider: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const outcomes = useQueries({
    queries: changes.map(({ changeId }) => ({
      queryKey: ['price-change', changeId],
      queryFn: () => read<Outcome>(`view=priceChange&id=${changeId}`),
      refetchInterval: (query: { state: { data?: Outcome } }) =>
        !query.state.data || ['queued', 'executing'].includes(query.state.data.status)
          ? 1000
          : false,
    })),
  });
  const ready = preview?.previews.flatMap((item) => (item.preview ? [item.preview] : [])) ?? [];
  const allowed =
    provider && providers[provider].capabilities.updatePrices &&
    !!listing.providerAccountId &&
    listing.source !== 'demo';
  return (
    <>
      <Button
        variant="ghost"
        className="h-6 px-1"
        aria-label={`Edit ${listing.marketplace === 'spaceship' ? 'SellerHub' : listing.marketplace} price for ${domainName}`}
        title={
          allowed
            ? 'Preview provider-specific BIN change'
            : 'Connect and synchronize this listing before editing its remote price'
        }
        disabled={!allowed || workspace.role === 'VIEWER'}
        onClick={() => {
          setPrice(listing.binPrice || '');
          setPreview(undefined);
          setChanges([]);
          setSyncAll(false);
          setOpen(true);
        }}
      >
        <PencilLine size={13} />
      </Button>
      <Modal
        title="Update marketplace BIN price"
        description={`${domainName} · ${listing.marketplace}`}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="stack">
          {changes.length ? (
            <>
              {changes.map((change, index) => {
                const outcome = outcomes[index].data;
                return (
                  <div className="notice" role="status" key={change.changeId}>
                    <div>
                      <strong className="mr-2">{change.provider}</strong>
                      <Badge
                        tone={
                          outcome?.status === 'completed'
                            ? 'green'
                            : outcome?.status === 'failed'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {outcome?.status || 'queued'}
                      </Badge>
                      <p>
                        {outcome?.status === 'completed'
                          ? `Provider price verified: ${formatMoney(outcome.newPrice, outcome.currency)}`
                          : outcome?.error || 'Waiting for the provider to confirm the new price.'}
                      </p>
                    </div>
                    {outcome?.error && change.provider === 'Dynadot' && (
                      <p>In Dynadot, check the transfer lock under My Domains → Manage Domains.</p>
                    )}
                  </div>
                );
              })}
              <Link href="/sync#provider-jobs" className="text-link">
                View provider jobs
              </Link>
              {outcomes.every(
                ({ data }) => data && !['queued', 'executing'].includes(data.status),
              ) &&
                outcomes.some(({ data }) => data?.status === 'failed') && (
                  <Button
                    onClick={() => {
                      setPreview(undefined);
                      setChanges([]);
                    }}
                  >
                    Edit price and preview again
                  </Button>
                )}
              <Button
                onClick={async () => {
                  await cache.invalidateQueries();
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              {listing.marketplace === 'dynadot' && (
                <div className="notice text-xs">
                  <span>
                    <strong>Dynadot requirement:</strong> Ensure {domainName} is unlocked in your
                    Dynadot account (Manage Domains &gt; Unlock Domains) so Dynadot allows
                    marketplace listing price updates.
                  </span>
                </div>
              )}
              {(!workspace.pricePublishingAvailable || !workspace.pricePublishingEnabled) && (
                <div className="notice notice-amber">
                  <p>
                    Price publishing is off. You can preview a change, then{' '}
                    <Link className="text-link" href="/settings?tab=publishing">
                      enable publishing in workspace settings
                    </Link>
                    .
                  </p>
                </div>
              )}
              {preview ? (
                <>
                  <div className="stack">
                    <p>
                      New BIN price{' '}
                      <strong>{formatMoney(preview.newPrice, preview.currency)}</strong>
                    </p>
                    {preview.previews.map((item) => (
                      <div className="notice" key={item.preview?.id ?? item.provider}>
                        <p>
                          <strong>{item.provider}</strong>{' '}
                          {item.preview ? (
                            <span>{formatMoney(item.preview.oldPrice, item.preview.currency)}</span>
                          ) : (
                            item.reason
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="muted text-xs">
                    {syncAll
                      ? 'Confirmation saves the portfolio asking price and queues each previewed marketplace for verification. Listings with an explanation above will be skipped.'
                      : 'Confirmation queues this marketplace BIN price for verification.'}{' '}
                    Preview expires in five minutes.
                  </p>
                  <div className="dialog-actions">
                    <Button onClick={() => setPreview(undefined)}>Edit price</Button>
                    <Button
                      variant="primary"
                      disabled={
                        busy ||
                        !ready.length ||
                        !workspace.pricePublishingAvailable ||
                        !workspace.pricePublishingEnabled
                      }
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const results = syncAll
                            ? await api<ConfirmedChange[]>('listing.price.confirm_all', {
                                previewIds: ready.map(({ id }) => id),
                              })
                            : [
                                await api<ConfirmedChange>('listing.price.confirm', {
                                  previewId: ready[0].id,
                                }),
                              ];
                          setChanges(
                            results.map((result) => ({
                              ...result,
                              provider:
                                ready.find(({ id }) => id === result.changeId)?.provider ??
                                listing.marketplace,
                            })),
                          );
                          toast.success('Confirmed and queued; awaiting provider verification.');
                        } catch (error) {
                          toast.error((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Confirm & queue price change
                    </Button>
                  </div>
                </>
              ) : (
                <form
                  method="post"
                  className="stack"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    try {
                      const input = { listingId: listing.id, newPrice: price };
                      if (syncAll)
                        setPreview(await api<PreviewGroup>('listing.price.preview_all', input));
                      else {
                        const single = await api<Preview>('listing.price.preview', input);
                        setPreview({
                          newPrice: single.newPrice,
                          currency: single.currency,
                          previews: [{ provider: single.provider, preview: single, reason: null }],
                        });
                      }
                    } catch (error) {
                      toast.error((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      New BIN price ({listing.currency})
                    </span>
                    {askingPrice && (
                      <button
                        type="button"
                        className="text-xs text-link underline font-medium"
                        onClick={() => setPrice(askingPrice)}
                      >
                        Set to asking price ({formatMoney(askingPrice, listing.currency)})
                      </button>
                    )}
                  </div>
                  <Input
                    required
                    aria-label={`New BIN price (${listing.currency})`}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="decimal"
                    placeholder="Enter price..."
                  />
                  {targetDomainId && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs p-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                      <input
                        type="checkbox"
                        checked={syncAll}
                        onChange={(e) => setSyncAll(e.target.checked)}
                      />
                      <span>
                        Also update portfolio asking price and sync all marketplaces to this price
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-muted">
                    {['spaceship', 'dynadot', 'sedo'].includes(listing.marketplace)
                      ? 'Positive price with at most two decimal places.'
                      : 'Positive whole-dollar USD amount.'}
                  </p>
                  <Button variant="primary" disabled={busy}>
                    {busy ? 'Fetching current provider price…' : 'Preview provider change'}
                  </Button>
                </form>
              )}
              {!changes.length && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <p className="text-xs text-muted">
                    {canOpenRemoval
                      ? removalProvider === 'atom'
                        ? 'Standard listings can be delisted here. Manage other tiers in Atom.'
                        : 'Removal requires confirmation.'
                      : 'Delist directly at the provider.'}
                  </p>
                  {removalProvider && targetDomainId && listing.providerAccountId && (
                    <ProviderAction
                      action="removeListing"
                      provider={removalProvider}
                      listingAccountId={listing.providerAccountId}
                      domain={{
                        id: targetDomainId,
                        name: domainName,
                        askingPrice: askingPrice ?? null,
                        currency: listing.currency,
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
