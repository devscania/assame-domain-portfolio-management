'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from './ui';
export function ProfileNameForm({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      method="post"
      className="password-change-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const response = await fetch('/api/account/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setMessage('Name saved.');
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Unable to update your profile.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <Input name="name" defaultValue={name} required maxLength={100} autoComplete="name" />
      </Field>
      <Button variant="primary" disabled={busy} type="submit">
        Save name
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
