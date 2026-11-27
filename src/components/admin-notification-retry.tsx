'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NoticeKind } from '@/lib/admin-notification-operations';

export function AdminNotificationRetry({
  kind,
  id,
  reviewId,
}: {
  kind: NoticeKind;
  id: string;
  reviewId: string;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      className="admin-action-form"
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const response = await fetch('/api/admin/notifications/retry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, id, reviewId, confirmNonDelivery: confirmed }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to queue retry.');
          setMessage('Retry queued; the worker will recheck current eligibility.');
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Unable to queue retry.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{' '}
        I verified non-delivery in the referenced case. This queues the one permitted retry.
      </label>{' '}
      <button type="submit" className="btn btn-secondary" disabled={busy || !confirmed}>
        Queue retry
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
