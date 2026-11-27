'use client';
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, formatMoney, type DomainRow } from './client';
import { useWorkspace } from './shell';
import { Button, Field, Input, Modal } from './ui';

export function AskingPriceEditor({
  domain,
}: {
  domain: Pick<DomainRow, 'id' | 'name' | 'askingPrice' | 'currency' | 'listings'>;
}) {
  const workspace = useWorkspace();
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const priceLabel = useId();
  const amount = domain.askingPrice ? formatMoney(domain.askingPrice, domain.currency) : null;

  return (
    <>
      {workspace.role === 'VIEWER' ? (
        <strong className="price-cell">{amount ?? '—'}</strong>
      ) : (
        <button
          type="button"
          className="asking-price-trigger"
          aria-label={`Edit asking price for ${domain.name}`}
          aria-describedby={priceLabel}
          onClick={() => {
            setPrice(domain.askingPrice || '');
            setOpen(true);
          }}
        >
          <span id={priceLabel} className={amount ? 'price-cell' : 'muted'}>
            {amount ?? 'Set asking price'}
          </span>
          <PencilLine size={13} aria-hidden="true" />
        </button>
      )}

      {open && (
        <Modal
          title="Portfolio asking price"
          description={`${domain.name} · Internal asking price`}
          open={open}
          onOpenChange={setOpen}
        >
          <form
            method="post"
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('domain.asking_price', {
                  domainId: domain.id,
                  askingPrice: price ? Number(price).toFixed(2) : null,
                });
                await query.invalidateQueries();
                setOpen(false);
                toast.success(`Asking price updated for ${domain.name}`);
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label={`Asking price (${domain.currency})`}
              hint="Leave blank if unset. This sets your target price across Assame."
            >
              <Input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 5000"
                autoFocus
              />
            </Field>

            <p className="text-xs text-muted">
              Provider listings are not changed. Use the provider-specific price preview to publish
              a price.
            </p>

            <div className="dialog-actions">
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save asking price'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
