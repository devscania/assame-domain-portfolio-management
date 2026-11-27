'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthCard } from './auth-card';
import { useClientReady } from './use-client-ready';

type Mode = 'forgot' | 'verify' | 'reset';
export function AuthEmailForm({ mode, token }: { mode: Mode; token?: string }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);
  const ready = useClientReady();
  const title =
    mode === 'forgot'
      ? 'Reset your password'
      : mode === 'reset'
        ? 'Choose a new password'
        : token
          ? 'Verify your email'
          : 'Resend verification';
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const action =
      mode === 'forgot'
        ? 'request-reset'
        : mode === 'reset'
          ? 'reset'
          : token
            ? 'verify'
            : 'request-verify';
    try {
      const response = await fetch('/api/auth-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, action, token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'verify') setVerified(true);
      else
        setMessage(
          action === 'reset'
            ? 'Your password has been changed. You can now sign in.'
            : 'If an eligible account exists, an email will be sent.',
        );
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (verified)
    return (
      <AuthCard title="Verification complete" kind="email">
        <p role="status">Email verified. You can now sign in.</p>
        <Link className="marketing-button" href="/login">Sign in</Link>
      </AuthCard>
    );
  return (
    <AuthCard title={title} kind="email">
      <p>
        {mode === 'forgot' || (mode === 'verify' && !token)
          ? 'Enter the email address associated with your account.'
          : mode === 'verify'
            ? 'Confirm your email to finish setting up your account.'
            : 'Choose a password of at least 12 characters.'}
      </p>
      {mode === 'reset' && !token && (
        <div className="auth-link-notice" role="status">
          <p>This reset link is incomplete. Request a new link to choose your password.</p>
          <Link href="/forgot-password">Request a new reset link →</Link>
        </div>
      )}
      <form method="post" onSubmit={submit}>
        {(mode === 'forgot' || (mode === 'verify' && !token)) && (
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
        )}
        {mode === 'reset' && (
          <>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
          </>
        )}
        <button
          className="marketing-button"
          disabled={!ready || busy || (mode === 'reset' && !token)}
        >
          {busy
            ? 'Please wait…'
            : mode === 'verify' && token
              ? 'Verify email'
              : mode === 'reset'
                ? 'Change password'
                : 'Send email'}
        </button>
      </form>
      <noscript>
        <p>Enable JavaScript to submit this form.</p>
      </noscript>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
      <Link href="/login">Back to sign in</Link>
    </AuthCard>
  );
}
