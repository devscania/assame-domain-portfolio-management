'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function AdminAlertActions({ id, isRead }: { id: string; isRead: boolean }) {
  const router = useRouter();
  const query = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(action: 'read' | 'dismiss') {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Unable to update alert.');
      }
      void query.invalidateQueries({ queryKey: ['admin-unread-alerts'] });
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to update alert.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="row wrap">
      {!isRead && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={() => void update('read')}
        >
          Mark read
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() => void update('dismiss')}
      >
        Dismiss
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
