'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, formatMoney, type Registration } from './client';
import { useWorkspace } from './shell';
import { Button, Field, Input, Modal } from './ui';

export function RenewalCostEditor({
  registration,
  domainName,
}: {
  registration: Registration | undefined;
  domainName: string;
}) {
  const workspace = useWorkspace();
  const query = useQueryClient();
  const [open, setOpen] = useState(false),
    [amount, setAmount] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <strong>{formatMoney(registration?.renewalCost, registration?.currency)}</strong>
        <Button
          variant="ghost"
          disabled={!registration || workspace.role === 'VIEWER'}
          aria-label={`Edit renewal cost for ${domainName}`}
          onClick={() => {
            setAmount(registration?.renewalCost || '');
            setOpen(true);
          }}
        >
          <PencilLine size={13} />
        </Button>
      </div>
      {open && (
        <Modal
          title="Annual renewal estimate"
          description={`${domainName} · ${registration?.registrar}`}
          open={open}
          onOpenChange={setOpen}
        >
          <form
            method="post"
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api('registration.renewalCost', {
                  registrationId: registration!.id,
                  amount: amount || null,
                });
                await query.invalidateQueries();
                setOpen(false);
                toast.success('Renewal estimate saved');
              } catch (error) {
                toast.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label={`Annual renewal cost (${registration?.currency})`}
              hint="Leave blank for unknown. This changes the forecast, not paid expenses or expiration dates."
            >
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Button variant="primary" disabled={busy}>
              Save renewal estimate
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
