'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NoticeKind } from '@/lib/admin-notification-operations';

export function AdminNotificationReview({
  kind,
  id,
  status,
}: {
  kind: NoticeKind;
  id: string;
  status: 'failed' | 'sending';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('unresolved');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!open)
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        Record review
      </button>
    );
  return (
    <form
      className="admin-action-form"
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const response = await fetch('/api/admin/notifications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind,
              id,
              expectedStatus: status,
              outcome,
              caseReference: reference,
              confirm,
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to record review.');
          setMessage('Review recorded. Delivery state remains unchanged.');
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Unable to record review.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Review outcome{' '}
        <select
          className="input"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        >
          <option value="unresolved">Unresolved</option>
          <option value="delivered">Evidence of delivery</option>
          <option value="not_delivered">Evidence of non-delivery</option>
        </select>
      </label>
      <label>
        Support case{' '}
        <input
          className="input"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          pattern="[A-Za-z0-9][A-Za-z0-9._/\-]*"
          minLength={3}
          maxLength={80}
          required
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirm}
          onChange={(event) => setConfirm(event.target.checked)}
          required
        />{' '}
        I reviewed this delivery and will record only the evidence in the referenced case.
      </label>
      <button className="btn btn-secondary" type="submit" disabled={busy || !confirm}>
        Save review
      </button>{' '}
      <button
        className="btn btn-secondary"
        type="button"
        disabled={busy}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
