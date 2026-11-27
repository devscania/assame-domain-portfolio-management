'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthCard } from './auth-card';
export function ConfirmSignInRemoval({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  return (
    <AuthCard title="Remove sign-in method" kind="security">
      <p>
        Confirm the request sent to your account email. You will be signed out on all devices after
        removal.
      </p>
      {!token && (
        <p className="auth-link-notice" role="status">
          Open the complete confirmation link from your email, or request another from account
          security.
        </p>
      )}
      <button
        className="marketing-button"
        type="button"
        disabled={!token || busy || done}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const response = await fetch('/api/account/oauth-removal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'confirm', token }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setDone(true);
            setMessage('Sign-in method removed. Sign in again using another method.');
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : 'Unable to remove this sign-in method.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Please wait...' : 'Confirm removal'}
      </button>
      {message && <p role={done ? 'status' : 'alert'}>{message}</p>}
      <Link href="/login">Back to sign in</Link>
    </AuthCard>
  );
}
