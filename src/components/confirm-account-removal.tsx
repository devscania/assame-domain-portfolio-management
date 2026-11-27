'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthCard } from './auth-card';
import { signOut } from 'next-auth/react';
export function ConfirmAccountRemoval({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <AuthCard title="Remove account" kind="danger">
      <p>
        This permanently removes your account and solely owned workspaces. Provider assets are not
        changed.
      </p>
      {!token && (
        <p className="auth-link-notice" role="status">
          This confirmation link is incomplete. Return to settings to request another account
          removal link.
        </p>
      )}
      <p>
        Open this link in the same signed-in browser that requested it. Type DELETE ACCOUNT to
        confirm.
      </p>
      <label>
        Confirmation{' '}
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      <button
        className="marketing-button"
        type="button"
        disabled={!token || busy || confirmation !== 'DELETE ACCOUNT'}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const response = await fetch('/api/account/removal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'confirm', token, confirmation }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            await signOut({ callbackUrl: '/login' });
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to remove the account.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Removing…' : 'Permanently remove account'}
      </button>
      {message && <p role="status">{message}</p>}
      <Link href="/settings">Return to settings</Link>
    </AuthCard>
  );
}
