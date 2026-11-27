'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button, Field, Input } from './ui';

export function PasswordChangeForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await signOut({ callbackUrl: '/login' });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to change password.');
      setBusy(false);
    }
  }
  return (
    <form method="post" className="password-change-form" onSubmit={submit}>
      <Field label="Current password">
        <Input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </Field>
      <Field label="New password" hint="At least 12 characters.">
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Field label="Confirm new password">
        <Input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button variant="primary" disabled={busy} type="submit">
        {busy ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  );
}
