'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from './client';
import { Button, Field, Input } from './ui';
export function AccountRemovalControls({ hasPassword }: { hasPassword: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <details className="permissions">
      <summary>Remove my account</summary>
      <p>
        Deletes your user account and workspaces where you are the only member. Shared workspaces
        you own must be transferred or removed first. Provider assets are not changed. If you use
        only Google or Discord, you can request a confirmation link instead of adding a password.
      </p>
      {hasPassword && (
        <form
          method="post"
          className="stack mt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api('account.delete', Object.fromEntries(new FormData(event.currentTarget)));
              await signOut({ callbackUrl: '/login' });
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Confirm current password">
            <Input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label="Type DELETE ACCOUNT">
            <Input name="confirmation" required />
          </Field>
          <Button variant="danger" disabled={busy}>
            Permanently remove account
          </Button>
        </form>
      )}
      {!hasPassword && (
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const response = await fetch('/api/account/removal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request' }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              toast.success('Check your email and open the link in this signed-in browser.');
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Email removal link for OAuth-only account
        </Button>
      )}
    </details>
  );
}
