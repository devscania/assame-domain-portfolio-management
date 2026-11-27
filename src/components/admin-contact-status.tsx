'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui';
import { contactStatusLabels, type ContactStatus } from '@/lib/contact-status';

export function AdminContactStatus({
  id,
  name,
  initial,
}: {
  id: string;
  name: string;
  initial: ContactStatus;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(initial);
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <form
      method="post"
      className="admin-contact-status"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        setFailed(false);
        try {
          const response = await fetch('/api/admin/contacts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, expected: current, status }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to update request status.');
          setCurrent(status);
          setMessage('Status updated.');
          router.refresh();
        } catch (error) {
          setFailed(true);
          setMessage(error instanceof Error ? error.message : 'Unable to update request status.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Status for {name}{' '}
        <select
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value as ContactStatus)}
          disabled={busy}
        >
          {Object.entries(contactStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>{' '}
      <Button type="submit" disabled={busy || status === current}>
        Save status
      </Button>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
  );
}
