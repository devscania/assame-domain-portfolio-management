'use client';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from './ui';

type LoginSession = {
  id: string;
  method: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};
export function AccountSessions() {
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/account/sessions', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load sessions.');
        const result = await response.json();
        if (active) setSessions(result.sessions);
      })
      .catch(() => {
        if (active) setMessage('Unable to load sessions.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function revoke(id: string) {
    setBusy(id);
    setMessage('');
    try {
      const response = await fetch('/api/account/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign out device.');
      if (result.current) {
        await signOut({ callbackUrl: '/login' });
        return;
      }
      setSessions((current) => current.filter((session) => session.id !== id));
      setMessage('Session signed out.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign out device.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="account-session-list">
      <p>
        Each sign-in is shown separately. Session details do not include your IP address or browser
        history.
      </p>
      {sessions.length > 0 && (
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              <span>
                {session.current ? 'This session' : 'Other session'} ·{' '}
                {session.method === 'credentials'
                  ? 'Email and password'
                  : session.method === 'google'
                    ? 'Google'
                    : 'Discord'}{' '}
                · Signed in {new Date(session.createdAt).toLocaleString()} · Expires{' '}
                {new Date(session.expiresAt).toLocaleString()}
              </span>{' '}
              <Button
                type="button"
                variant="secondary"
                disabled={!!busy}
                onClick={() => void revoke(session.id)}
              >
                {session.current ? 'Sign out this session' : 'Sign out session'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
