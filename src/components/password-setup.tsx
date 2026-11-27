'use client';
import { useState } from 'react';
import { Button } from './ui';

export function PasswordSetup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div>
      <Button
        type="button"
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const response = await fetch('/api/account/password-setup', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setMessage(
              'Check your account email for a link to set your password. The link expires in one hour.',
            );
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to send the setup email.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Email me a password setup link
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
