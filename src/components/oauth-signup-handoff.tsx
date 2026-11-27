'use client';

import { useEffect } from 'react';
import { AuthCard } from './auth-card';
import { oauthSignupHandoffFinished } from './analytics';

/** Only a consenting OAuth sign-in uses this public, bounded handoff. */
export function OAuthSignupHandoff({ next }: { next: string }) {
  useEffect(() => {
    let navigating = false;
    const finish = () => {
      if (navigating) return;
      navigating = true;
      window.location.replace(next);
    };
    const checkConsent = () => {
      try {
        if (localStorage.getItem('assame.analytics-consent.v1') !== 'accepted') finish();
      } catch {
        finish();
      }
    };
    window.addEventListener(oauthSignupHandoffFinished, finish);
    window.addEventListener('assame-analytics-consent', checkConsent);
    window.addEventListener('storage', checkConsent);
    try {
      if (
        localStorage.getItem('assame.analytics-consent.v1') !== 'accepted' ||
        !sessionStorage.getItem('assame.analytics-oauth-signup.v1') ||
        !/(?:^|;\s*)assame-oauth-analytics=(google|discord)(?:;|$)/.test(document.cookie)
      )
        finish();
    } catch {
      finish();
    }
    // Do not hold up sign-in if analytics or storage is unavailable.
    const timer = window.setTimeout(finish, 1500);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(oauthSignupHandoffFinished, finish);
      window.removeEventListener('assame-analytics-consent', checkConsent);
      window.removeEventListener('storage', checkConsent);
    };
  }, [next]);

  return (
    <AuthCard title="Finishing sign-in" kind="progress">
      <p>Taking you to your account…</p>
      <a className="text-link" href={next}>
        Continue
      </a>
    </AuthCard>
  );
}
