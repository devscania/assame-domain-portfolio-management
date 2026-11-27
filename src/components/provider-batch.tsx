'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isAvailableProvider, providers } from '@/integrations/catalog';
import { marketplaceNameservers } from '@/integrations/provider-batch-options';
import { nameserverEligibleAccounts, type NameserverAccount } from '@/lib/nameserver-policy';
import { api, read, formatMoney, type DomainRow, type Summary } from './client';
import { useWorkspace } from './shell';
import { Button, Field, Input, Modal } from './ui';

type Mode = 'addListing' | 'changeNameservers';
type Result = {
  domainId: string;
  name?: string;
  error?: string;
  preview?: {
    id: string;
    provider: string;
    input: { price?: string; nameservers?: string[] };
    currentNameservers?: string[];
  };
};

export function ProviderBatch({
  mode, domains, accounts, onClose,
}: { mode: Mode; domains: DomainRow[]; accounts: Summary['accounts']; onClose: () => void }) {
  const workspace = useWorkspace();
  const cache = useQueryClient();
  const dns = mode === 'changeNameservers';
  const [accountId, setAccountId] = useState('');
  const [price, setPrice] = useState('');
  const [useAsking, setUseAsking] = useState(true);
  const [hosts, setHosts] = useState('');
  const [results, setResults] = useState<Result[]>();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(0);
  const policy = useQuery({
    queryKey: ['provider-action-policy', workspace.id],
    queryFn: () => read<{ accounts: NameserverAccount[] }>('view=providerActionPolicy'),
    enabled: dns,
  });
  const listingAccounts = accounts.filter((account) =>
    account.status === 'connected' && isAvailableProvider(account.providerId) &&
    providers[account.providerId].capabilities.addListings);
  const selected = accountId || listingAccounts[0]?.id;
  const selectedAccount = listingAccounts.find((account) => account.id === selected);
  const ready = results?.flatMap(({ preview }) => preview ? [preview.id] : []) ?? [];

  async function preview() {
    const nameservers = hosts.split(/[\s,]+/).filter(Boolean);
    const items = [];
    const skipped: Result[] = [];
    for (const domain of domains) {
      const account = dns
        ? nameserverEligibleAccounts(domain.registrations, policy.data?.accounts ?? [])[0]?.id
        : selected;
      const amount = useAsking ? (domain.currency === 'USD' ? domain.askingPrice : null) : price;
      const error = !account ? 'Sync this domain from its supported registrar account first.'
        : !dns && (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
          ? 'Enter a positive USD Buy Now price or set a USD asking price.' : null;
      if (error) skipped.push({ domainId: domain.id, name: domain.name, error });
      else items.push(dns
        ? { action: mode, domainId: domain.id, accountId: account, nameservers }
        : { action: mode, domainId: domain.id, accountId: account, price: amount, currency: 'USD' });
    }
    const remote = items.length ? await api<Result[]>('provider.batch.preview', { items }) : [];
    const byId = new Map([...remote, ...skipped].map((item) => [item.domainId, item]));
    setResults(domains.flatMap((domain) => {
      const row = byId.get(domain.id);
      return row ? [row] : [];
    }));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={dns ? 'Change nameservers for selected domains' : 'List selected domains'}
      description={`${domains.length} selected domains`} wide>
      {queued ? (
        <div className="stack">
          <p>{queued} {queued === 1 ? 'change' : 'changes'} queued.</p>
          <Link href="/sync#provider-jobs" className="text-link">Track provider jobs</Link>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : results ? (
        <div className="stack">
          <p>{ready.length} ready · {results.length - ready.length} skipped</p>
          <ul className="stack">
            {results.map(({ domainId, name, error, preview }) => (
              <li key={domainId}>
                <strong>{name || domainId}</strong>{' '}
                {error || (dns
                  ? `· ${preview?.provider} · ${preview?.currentNameservers?.join(', ')} → ${preview?.input.nameservers?.join(', ')}`
                  : `· ${preview?.provider} · ${selectedAccount?.label} · ${formatMoney(preview?.input.price, 'USD')}`)}
              </li>
            ))}
          </ul>
          {dns && <p className="notice notice-amber">This changes where DNS is served and can disrupt website and email. The marketplace decides when verification is complete.</p>}
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setResults(undefined)}>Back</Button>
            <Button variant="primary" disabled={busy || !ready.length} onClick={() => void run(async () => {
              const jobs = await api<{ jobId: string }[]>('provider.batch.confirm', { ids: ready });
              setQueued(jobs.length);
              void cache.invalidateQueries();
            })}>Confirm {ready.length} {dns ? 'changes' : 'listings'}</Button>
          </div>
        </div>
      ) : (
        <form method="post" className="stack" onSubmit={(event) => {
          event.preventDefault();
          void run(preview);
        }}>
          {dns ? (
            <>
              <Field label="Marketplace nameservers">
                <select className="input" defaultValue="" onChange={(event) => {
                  const preset = marketplaceNameservers[event.target.value as keyof typeof marketplaceNameservers];
                  setHosts(preset?.hosts.join('\n') ?? '');
                }}>
                  <option value="">Enter nameservers manually</option>
                  {Object.entries(marketplaceNameservers).map(([id, preset]) => (
                    <option key={id} value={id}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nameservers" hint="For domain-specific verification, enter the exact nameservers provided by the marketplace.">
                <textarea className="input" rows={3} required value={hosts} onChange={(event) => setHosts(event.target.value)} />
              </Field>
              <p>Changes go to the verified registrar for each domain. Eligible registrars are Namecheap and Spaceship.</p>
              {policy.isError && <p>Registrar eligibility could not be loaded. Reopen this dialog to retry.</p>}
            </>
          ) : (
            <>
              <Field label="Marketplace account">
                <select className="input" required value={selected ?? ''} onChange={(event) => setAccountId(event.target.value)}>
                  {!listingAccounts.length && <option value="">No connected marketplace accounts</option>}
                  {listingAccounts.map((account) => (
                    <option value={account.id} key={account.id}>{account.providerId === 'spaceship' ? 'SellerHub' : providers[account.providerId as keyof typeof providers].name} · {account.label}</option>
                  ))}
                </select>
              </Field>
              <label className="check-label">
                <input type="checkbox" checked={useAsking} onChange={(event) => setUseAsking(event.target.checked)} />
                Use each domain’s USD asking price
              </label>
              {!useAsking && <Field label="Buy Now price for all domains (USD)">
                <Input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
              </Field>}
            </>
          )}
          <Button variant="primary" disabled={busy || (dns ? policy.isPending || policy.isError : !selected)}>
            {busy ? 'Checking domains…' : 'Preview changes'}
          </Button>
        </form>
      )}
    </Modal>
  );
}
