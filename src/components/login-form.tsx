'use client';
import { useState } from 'react';
import Link from 'next/link';
import { signIn, signOut } from 'next-auth/react';
import { ArrowRight, Globe2, Layers3, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ProviderIcon } from './provider-icon';
import { Button, Field, Input } from './ui';
import { beginOAuthSignupIntent, trackPublicEvent } from './analytics';
import { useClientReady } from './use-client-ready';
import { PublicTheme } from './public-theme';
export function LoginForm({
  demo,
  brand,
  initialRegister = false,
  providers = [],
  oauthError = false,
  returnTo = '/overview',
  clearStaleSession = false,
}: {
  demo: boolean;
  brand: string;
  initialRegister?: boolean;
  providers?: ('google' | 'discord')[];
  oauthError?: boolean;
  returnTo?: string;
  clearStaleSession?: boolean;
}) {
  const [register, setRegister] = useState(initialRegister);
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const ready = useClientReady();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setNeedsVerification(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (register) {
        trackPublicEvent('registration_started');
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        trackPublicEvent('sign_up');
        toast.success('Check your email for a verification link.');
        setRegister(false);
        setBusy(false);
        return;
      }
      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      });
      if (result?.error === 'CredentialsSignin' && result.code === 'email_verification_required') {
        setNeedsVerification(true);
        setBusy(false);
        return;
      }
      if (result?.error)
        throw new Error('Unable to sign in. Check your credentials or try again later.');
      window.location.assign(returnTo);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          {brand}
          <span className="brand-dot">.</span>
        </div>
        <div className="story-content">
          <span className="eyebrow">A CLEARER PICTURE</span>
          <h2>
            Great domains.
            <br />
            One perspective.
          </h2>
          <p>
            Your assets, marketplaces, and next opportunities.
            <br />
            Beautifully connected in one workspace.
          </p>
          <div className="domain-art">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-center">
              <Globe2 size={48} />
            </div>
            <span className="art-domain art-a">
              orbit.studio <i />
            </span>
            <span className="art-domain art-b">
              makewaves.io <i />
            </span>
            <span className="art-domain art-c">
              nextchapter.com <i />
            </span>
            <span className="art-node art-n1" />
            <span className="art-node art-n2" />
          </div>
        </div>
        <div className="story-footer">
          <ShieldCheck size={16} /> Built for ownership. Designed for clarity.
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-panel-tools">
          <Link href="/">← Back to website</Link>
          <PublicTheme />
        </div>
        <div className="login-form-wrap">
          <Link className="login-mobile-brand" href="/" aria-label={`${brand} home`}>
            <span className="login-mobile-brand-mark">
              <Layers3 size={18} aria-hidden="true" />
            </span>
            {brand}
          </Link>
          <span className="eyebrow login-eyebrow">YOUR NEXT CHAPTER</span>
          <h1>{register ? 'Create your workspace' : 'Welcome back'}</h1>
          <p>
            {register
              ? 'A fresh perspective on your domain portfolio.'
              : 'Let’s put your portfolio in perspective.'}
          </p>
          {!register && needsVerification && (
            <p className="auth-link-notice" role="alert">
              Verify your email before signing in. Check your inbox for the verification link.
            </p>
          )}
          {oauthError && (
            <p role="alert">
              Unable to sign in with that provider. If you already have an account, sign in first
              and link it from account security.
            </p>
          )}
          {providers.length > 0 && (
            <div className="oauth-buttons">
              {providers.map((provider) => (
                <Button
                  type="button"
                  key={provider}
                  disabled={!ready || busy}
                  onClick={async () => {
                    if (!ready || busy) return;
                    setBusy(true);
                    try {
                      // Fresh sign-in must not carry a revoked identity into account linking.
                      if (clearStaleSession) await signOut({ redirect: false });
                      const handoff = beginOAuthSignupIntent(provider, register);
                      const callbackUrl = handoff
                        ? `/oauth-complete?next=${encodeURIComponent(returnTo)}`
                        : returnTo;
                      await signIn(provider, { callbackUrl });
                    } catch {
                      toast.error('Unable to start sign-in. Please try again.');
                      setBusy(false);
                    }
                  }}
                >
                  <ProviderIcon provider={provider} />
                  Continue with {provider === 'google' ? 'Google' : 'Discord'}
                </Button>
              ))}
            </div>
          )}
          <form method="post" onSubmit={submit}>
            {register && (
              <>
                <Field label="Your name (optional)">
                  <Input
                    name="name"
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                  />
                </Field>
                <Field label="Workspace name (optional)">
                  <Input name="workspace" maxLength={100} placeholder="My portfolio" />
                </Field>
              </>
            )}
            <Field label="Email address">
              <Input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password" hint={register ? 'At least 12 characters.' : undefined}>
              <Input
                type="password"
                name="password"
                required
                minLength={register ? 12 : 1}
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder="Enter your password"
              />
            </Field>
            {register && (
              <Field label="Confirm password">
                <Input
                  type="password"
                  name="confirmPassword"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
            )}
            {!register && (
              <p className="login-switch">
                <Link href="/forgot-password">Forgot password?</Link> ·{' '}
                <Link href="/verify-email">Resend verification</Link>
              </p>
            )}
            <Button
              variant="primary"
              disabled={!ready || busy}
              className="w-full mt-3"
              type="submit"
            >
              {busy ? 'Opening your workspace…' : register ? 'Create account' : 'Sign in'}
              <ArrowRight size={17} />
            </Button>
          </form>
          <noscript>
            <p>Enable JavaScript to sign in or create an account.</p>
          </noscript>
          {register && (
            <p className="login-switch">
              Review the <Link href="/terms">terms of service</Link> and{' '}
              <Link href="/privacy">privacy policy</Link>.
            </p>
          )}
          <p className="login-switch">
            {register ? 'Already have an account?' : 'New to Assame?'}{' '}
            <button type="button" disabled={!ready || busy} onClick={() => setRegister(!register)}>
              {register ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          {demo && (
            <div className="demo-login">
              <BadgeIcon />
              <div>
                <strong>Take a look around</strong>
                <p>
                  Sign in with the seeded demo account.
                  <br />
                  <code>demo@assame.local</code>
                  <br />
                  <code>AssameDemo!2026</code>
                </p>
                <small>Synthetic data · no live provider connections</small>
              </div>
            </div>
          )}
          <div className="login-fine">Your account. Your workspaces. Your portfolio.</div>
        </div>
      </section>
    </main>
  );
}
function BadgeIcon() {
  return <Globe2 size={23} className="text-teal-600 shrink-0" />;
}
