'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from './ui';
export function SignOutDevices() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      {!confirm ? (
        <Button type="button" onClick={() => setConfirm(true)}>
          Sign out all devices
        </Button>
      ) : (
        <>
          <p>This will also sign you out here. You will need to sign in again.</p>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/api/account/sessions', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                await signOut({ callbackUrl: '/login' });
              } catch (problem) {
                setError(
                  problem instanceof Error ? problem.message : 'Unable to sign out devices.',
                );
                setBusy(false);
              }
            }}
          >
            Confirm sign out all devices
          </Button>{' '}
          <Button type="button" disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
