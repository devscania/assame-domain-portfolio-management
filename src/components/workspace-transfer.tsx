'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Command =
  | { action: 'request'; organizationId: string; email: string; confirmation: string }
  | { action: 'accept' | 'decline' | 'cancel'; transferId: string };
export function TransferAction({
  action,
  transferId,
}: {
  action: 'accept' | 'decline' | 'cancel';
  transferId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError('');
    try {
      await submit({ action, transferId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete transfer.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="btn btn-primary" disabled={busy} onClick={run}>
        {action === 'accept'
          ? 'Accept ownership'
          : action === 'decline'
            ? 'Decline'
            : 'Cancel request'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
async function submit(data: Command) {
  const response = await fetch('/api/account/workspace-transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete transfer.');
}
export function TransferRequest({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      className="password-change-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await submit({ action: 'request', organizationId, email, confirmation });
          setEmail('');
          setConfirmation('');
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Unable to request transfer.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Request a transfer to an existing workspace member. They must accept within seven days.</p>
      <label>
        Member email{' '}
        <input
          className="input"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Type {name} to confirm{' '}
        <input
          className="input"
          required
          maxLength={200}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        Request transfer
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
