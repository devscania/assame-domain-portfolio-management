'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { ProviderIcon } from './provider-icon';
import { Button } from './ui';

type Provider = 'google' | 'discord';
export function OAuthLinkButtons({
  providers,
  linked,
  enabled,
}: {
  providers: Provider[];
  linked: string[];
  enabled: Provider[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function remove(provider: Provider) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/account/oauth-removal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', provider }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage('Check your account email to confirm removal. The link expires in one hour.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to request removal.');
    } finally {
      setBusy(false);
    }
  }
  async function link(provider: Provider) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/account/oauth-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) throw new Error('Unable to start linking. Please try again.');
      await signIn(provider, { callbackUrl: '/settings?tab=security' });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to start linking.');
      setBusy(false);
    }
  }
  return (
    <div className="oauth-buttons">
      {providers.map((provider) => (
        <div key={provider}>
          {linked.includes(provider) ? (
            <Button type="button" disabled={busy} onClick={() => void remove(provider)}>
              <ProviderIcon provider={provider} />
              {`Email link to disconnect ${provider === 'google' ? 'Google' : 'Discord'}`}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || !enabled.includes(provider)}
              onClick={() => void link(provider)}
            >
              <ProviderIcon provider={provider} />
              {`Connect ${provider === 'google' ? 'Google' : 'Discord'}`}
            </Button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
