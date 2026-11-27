'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { isAvailableProvider, providers, type ProviderId } from '@/integrations/catalog';
import { api, read, formatMoney, type DomainRow, type Summary } from './client';
import { useWorkspace } from './shell';
import { Button, Field, Input, Modal, Badge } from './ui';
import { nameserverEligibleAccounts, type NameserverAccount, type NameserverRegistration } from '@/lib/nameserver-policy';
import { marketplaceNameservers } from '@/integrations/provider-batch-options';

type Preview = {
  id: string;
  domainName: string;
  provider: string;
  input: {
    action: string;
    price?: string;
    currency?: string;
    nameservers?: string[];
  };
  currentNameservers?: string[];
  currentNameserverProvider?: string;
  currentListing?: { price: string | null; currency: string; status: string };
  expiresAt: string;
};
export function ProviderAction({
  domain,
  action = 'addListing',
  provider,
  listingAccountId,
}: {
  domain: Pick<DomainRow, 'id' | 'name' | 'askingPrice' | 'currency'> & {
    registrations?: NameserverRegistration[];
  };
  action?: 'addListing' | 'changeNameservers' | 'removeListing';
  provider?: ProviderId;
  listingAccountId?: string;
}) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const nameservers = action === 'changeNameservers';
  const remove = action === 'removeListing';
  const { data: policy } = useQuery({
    queryKey: ['provider-action-policy', workspace.id],
    queryFn: () => read<{ accounts: NameserverAccount[] }>('view=providerActionPolicy'),
    enabled: nameservers && !workspace.demo && workspace.providerActionsEnabled && workspace.pricePublishingAvailable && ['OWNER', 'ADMIN'].includes(workspace.role),
    staleTime: 10000,
  });
  const eligible = nameserverEligibleAccounts(domain.registrations ?? [], policy?.accounts ?? []);
  const permitted =
    !workspace.demo &&
    (nameservers
      ? ['OWNER', 'ADMIN'].includes(workspace.role)
      : workspace.role !== 'VIEWER');
  if (nameservers && (!permitted || !eligible.length || !workspace.providerActionsEnabled || !workspace.pricePublishingAvailable)) return null;
  return (
    <>
      <Button
        variant={remove ? 'danger' : 'ghost'}
        className={remove ? 'delist-action' : undefined}
        disabled={!permitted}
        title={
          nameservers
            ? 'Change nameservers at a supported registrar'
              : remove
                ? 'Preview marketplace listing removal'
                : 'Preview a new marketplace listing'
        }
        aria-label={`${nameservers ? 'Change nameservers' : remove ? `Remove ${provider === 'spaceship' ? 'SellerHub' : provider ? providers[provider].name : 'marketplace'} listing` : `Add ${provider ? providers[provider].name : 'marketplace'} listing`} for ${domain.name}`}
        onClick={() => setOpen(true)}
      >
        {nameservers ? <ShieldCheck size={14} /> : !remove && <Plus size={13} />}{' '}
        {nameservers ? 'Change nameservers' : remove ? 'Delist' : 'Add listing'}
      </Button>
      {open && (
        <ProviderActionDialog
          domain={domain}
          action={action}
          provider={provider}
          listingAccountId={listingAccountId}
          nameserverAccounts={eligible}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ProviderActionDialog({
  domain,
  action,
  provider,
  listingAccountId,
  nameserverAccounts,
  onClose,
}: {
  domain: Pick<DomainRow, 'id' | 'name' | 'askingPrice' | 'currency'> & {
    registrations?: NameserverRegistration[];
  };
  action: 'addListing' | 'changeNameservers' | 'removeListing';
  provider?: ProviderId;
  listingAccountId?: string;
  nameserverAccounts: NameserverAccount[];
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const cache = useQueryClient();
  const open = true;
  const setOpen = (value: boolean) => {
    if (!value) onClose();
  };
  const [accountId, setAccountId] = useState('');
  const [price, setPrice] = useState(domain.currency === 'USD' ? domain.askingPrice || '' : '');
  const [nameserverText, setNameserverText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [changeId, setChangeId] = useState<string>();
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => read<Summary>('view=summary'),
    enabled: open && action !== 'changeNameservers',
  });
  const accounts = action === 'changeNameservers' ? nameserverAccounts : (summary?.accounts ?? []).filter(
    (a) =>
      isAvailableProvider(a.providerId) &&
      a.status !== 'disconnected' &&
      (!listingAccountId || a.id === listingAccountId) &&
      (!provider || a.providerId === provider) &&
      (action === 'removeListing'
        ? providers[a.providerId].capabilities.removeListings
        : providers[a.providerId].capabilities.addListings),
  );
  const selected = accountId || accounts[0]?.id || '';
  const { data: outcome, error: statusError } = useQuery({
    queryKey: ['provider-change', changeId],
    enabled: !!changeId,
    queryFn: () =>
      read<{ status: string; error: string | null }>(`view=providerChange&id=${changeId}`),
    refetchInterval: (q) =>
      !q.state.data || ['queued', 'executing'].includes(q.state.data.status) ? 1000 : false,
  });
  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nameservers = action === 'changeNameservers';
  const remove = action === 'removeListing';
  return (
    <>
      <Modal
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            void cache.invalidateQueries();
          }
          setOpen(v);
        }}
        title={
          nameservers
            ? 'Change registrar nameservers'
              : remove
                ? 'Remove marketplace listing'
                : 'Add marketplace listing'
        }
        description={domain.name}
      >
        {changeId ? (
          <div className="stack">
            <Badge
              tone={
                outcome?.status === 'completed'
                  ? 'green'
                  : outcome?.status === 'failed' || outcome?.status === 'unverified'
                    ? 'amber'
                    : 'neutral'
              }
            >
              {outcome?.status === 'completed' ? 'Provider confirmed' : outcome?.status === 'unverified' ? 'Confirmation pending' : outcome?.status || 'Queued'}
            </Badge>
            {outcome?.status === 'completed' ? (
              <p>
                {nameservers
                  ? 'The registrar confirmed the nameservers. Public DNS propagation can take time.'
                    : remove
                      ? 'The marketplace confirmed this listing was removed.'
                      : 'The provider confirmed the new listing and its BIN price. Its marketplace status is shown after synchronization.'}
              </p>
            ) : (
              <p>
                {outcome?.error ||
                  statusError?.message ||
                  'Your change is pending. Assame will check with the provider for confirmation.'}
              </p>
            )}
            {nameservers && outcome?.status === 'unverified' && <>
              <p>The provider has not confirmed the requested nameservers. This check only re-reads the registrar; it does not send the change again.</p>
              <Button disabled={busy} onClick={() => void run(async () => {
                await api('provider.nameserver.recheck', { id: changeId });
                await cache.invalidateQueries({ queryKey: ['provider-change', changeId] });
              })}>Check registrar confirmation</Button>
            </>}
            <Link href="/sync#provider-jobs" className="text-link">
              View job in Activity Center
            </Link>
            <Button
              onClick={() => {
                setOpen(false);
                void cache.invalidateQueries();
              }}
            >
              Done
            </Button>
          </div>
        ) : preview ? (
          <div className="stack">
            <h3>
              {preview.provider} · {preview.domainName}
            </h3>
            {remove && <p>Account: {accounts.find((a) => a.id === selected)?.label}</p>}
            {nameservers ? (
              <>
                <p>
                  <strong>Current:</strong> {preview.currentNameservers?.join(', ')}
                  {preview.currentNameserverProvider && ` (${preview.currentNameserverProvider})`}
                </p>
                <p>
                  <strong>New:</strong> {preview.input.nameservers?.join(', ')}
                </p>
                <p className="notice notice-amber">
                  This changes where DNS is served and can disrupt your website and email.
                  {preview.provider === 'Namecheap' &&
                    ' Namecheap URL forwarding, email forwarding and Dynamic DNS will stop working with custom nameservers.'}{' '}
                  Ensure the new DNS zone is ready before confirming.
                </p>
              </>
            ) : remove ? (
              <>
                <p>
                  Current BIN:{' '}
                  {formatMoney(
                    preview.currentListing?.price,
                    preview.currentListing?.currency || 'USD',
                  )}{' '}
                  · Status: {preview.currentListing?.status}
                </p>
                <p>
                  This removes the listing from {preview.provider}. Review the account and domain
                  above before confirming.
                </p>
              </>
            ) : (
              <>
                <p>
                  <strong>New BIN:</strong> {formatMoney(preview.input.price, 'USD')}
                </p>
                <p>
                  This creates a new listing that may become available for immediate purchase. Atom
                  submissions use Standard only; no premium coin is spent. Internal asking prices
                  and other marketplace prices remain unchanged.
                </p>
              </>
            )}
            {!workspace.providerActionsEnabled && (
              <p className="notice">
                Enable{' '}
                <Link href="/settings?tab=publishing" className="text-link">
                  Provider actions
                </Link>{' '}
                in Settings to confirm.
              </p>
            )}
            <Button
              variant="primary"
              disabled={
                busy || !workspace.providerActionsEnabled || !workspace.pricePublishingAvailable
              }
              onClick={() =>
                void run(async () => {
                  const result = await api<{ changeId: string }>('provider.change.confirm', {
                    id: preview.id,
                  });
                  setChangeId(result.changeId);
                })
              }
            >
              {busy
                ? 'Queuing…'
                : nameservers
                  ? 'Confirm nameserver change'
                    : remove
                      ? 'Confirm remove listing'
                      : 'Confirm add listing'}
            </Button>
            <Button disabled={busy} onClick={() => setPreview(undefined)}>
              Back
            </Button>
          </div>
        ) : (
          <form
            method="post"
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setPreview(
                  await api<Preview>(
                    'provider.change.preview',
                    nameservers
                      ? {
                          action,
                          domainId: domain.id,
                          accountId: selected,
                          nameservers: nameserverText.split(/[\s,]+/).filter(Boolean),
                        }
                      : remove
                          ? { action, domainId: domain.id, accountId: selected }
                          : {
                              action,
                              domainId: domain.id,
                              accountId: selected,
                              price,
                              currency: 'USD',
                            },
                  ),
                );
              });
            }}
          >
            <Field
              label={
                nameservers
                  ? 'Verified registrar account'
                    : 'Marketplace account'
              }
            >
              <select value={selected} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="" disabled>
                  Select connected account
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {providers[a.providerId as ProviderId].name} · {a.label}
                  </option>
                ))}
              </select>
            </Field>
            {!accounts.length && (
              <p className="notice">
                Connect a supported account in{' '}
                <Link href="/connections" className="text-link">
                  Integrations
                </Link>{' '}
                first.
              </p>
            )}
            {nameservers ? (
              <>
                <Field label="Marketplace nameservers">
                  <select value="" onChange={(event) => {
                    const preset = marketplaceNameservers[event.target.value as keyof typeof marketplaceNameservers];
                    if (preset) setNameserverText(preset.hosts.join(' '));
                  }}>
                    <option value="">Choose a preset or enter nameservers below</option>
                    {Object.entries(marketplaceNameservers).map(([id, preset]) => (
                      <option key={id} value={id}>{preset.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="New nameservers" hint="Use the exact hostnames from the marketplace for domain-specific verification.">
                  <Input required value={nameserverText} onChange={(e) => setNameserverText(e.target.value)} />
                </Field>
              </>
            ) : !remove ? (
              <Field label="New listing BIN (USD)">
                <Input
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
            ) : null}
            <Button variant="primary" disabled={busy || !selected}>
              {busy ? 'Checking provider…' : 'Preview exact change'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}
