'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
const enabled = /^G-[A-Z0-9]+$/.test(measurementId);
const key = 'assame.analytics-consent.v1';
const changeEvent = 'assame-analytics-consent';
const preferenceEvent = 'assame-analytics-preferences';
const oauthSignupKey = 'assame.analytics-oauth-signup.v1';
export const oauthSignupHandoffFinished = 'assame-oauth-signup-finished';
function clearOAuthSignupIntent() {
  try {
    sessionStorage.removeItem(oauthSignupKey);
  } catch {
    /* Storage can be unavailable. */
  }
  document.cookie = 'assame-oauth-analytics=; Path=/; Max-Age=0; SameSite=Lax';
}
const publicPaths = new Set([
  '/',
  '/features',
  '/integrations',
  '/faq',
  '/contact',
  '/privacy',
  '/terms',
  '/about',
  '/blog',
  '/blog/organize-domain-portfolios-across-workspaces',
  '/blog/domain-renewal-review-checklist',
  '/blog/track-domain-sales-and-installments',
  '/blog/organize-domain-portfolio-costs',
  '/login',
  '/register',
  '/oauth-complete',
]);
const denied = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
};

type Consent = 'accepted' | 'rejected' | 'unset';
type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
  [key: `ga-disable-${string}`]: boolean | undefined;
};
function readConsent(): Consent {
  try {
    const value = localStorage.getItem(key);
    return value === 'accepted' || value === 'rejected' ? value : 'unset';
  } catch {
    return 'unset';
  }
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key && event.newValue === 'rejected') {
      clearOAuthSignupIntent();
      try {
      } catch {
        // Storage can be unavailable.
      }
    }
    callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, callback);
  };
}
function saveConsent(value: Exclude<Consent, 'unset'>) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
  if (value === 'rejected') {
    clearOAuthSignupIntent();
    try {
    } catch {
      /* Storage can be unavailable. */
    }
  }
  window.dispatchEvent(new Event(changeEvent));
}
type PublicEvent =
  | 'sign_up_cta_click'
  | 'registration_started'
  | 'sign_up'
  | 'contact_request_submitted';
/** Only fixed event names and properties may reach the analytics tag. */
export function trackPublicEvent(
  name: PublicEvent,
  method: 'email' | 'google' | 'discord' = 'email',
  onProcessed?: () => void,
) {
  if (
    typeof window === 'undefined' ||
    !enabled ||
    readConsent() !== 'accepted' ||
    !publicPaths.has(window.location.pathname)
  )
    return;
  const w = window as unknown as AnalyticsWindow;
  if (w[`ga-disable-${measurementId}`] || !w.gtag) return;
  w.gtag('event', name, {
    ...(name === 'sign_up' || name === 'registration_started' ? { method } : {}),
    ...(onProcessed ? { event_callback: onProcessed, event_timeout: 1000 } : {}),
    page_location: window.location.origin + window.location.pathname,
    page_referrer: '',
  });
}
/** Keep only an ephemeral provider intent, and only after explicit analytics consent. */
export function beginOAuthSignupIntent(
  method: 'google' | 'discord',
  registration: boolean,
): boolean {
  if (!enabled || readConsent() !== 'accepted') return false;
  if (registration) trackPublicEvent('registration_started', method);
  try {
    sessionStorage.setItem(oauthSignupKey, JSON.stringify({ method, at: Date.now() }));
    document.cookie = `assame-oauth-analytics=${method}; Path=/; Max-Age=3600; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    return document.cookie
      .split(';')
      .some((value) => value.trim() === `assame-oauth-analytics=${method}`);
  } catch {
    /* Analytics must not interrupt sign-in. */
    return false;
  }
}
export function trackContactSubmission() {
  trackPublicEvent('contact_request_submitted');
}

export function AnalyticsPreferences() {
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="analytics-preferences"
      onClick={() => window.dispatchEvent(new Event(preferenceEvent))}
    >
      Analytics preferences
    </button>
  );
}
export function AnalyticsController() {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribe, readConsent, () => 'unset' as Consent);
  const [editing, setEditing] = useState(false);
  const lastPage = useRef<string | null>(null);
  const allowed = !!pathname && publicPaths.has(pathname);
  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener(preferenceEvent, open);
    return () => window.removeEventListener(preferenceEvent, open);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const click = (event: MouseEvent) => {
      if (
        readConsent() !== 'accepted' ||
        !publicPaths.has(window.location.pathname) ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href === '/register') trackPublicEvent('sign_up_cta_click');
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const w = window as unknown as AnalyticsWindow;
    const disableKey = `ga-disable-${measurementId}` as const;
    if (!allowed || consent !== 'accepted') {
      lastPage.current = null;
      w[disableKey] = true;
      w.gtag?.('consent', 'update', denied);
      return;
    }
    w[disableKey] = false;
    if (!w.gtag) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function () {
        // Google's queue expects an arguments object.
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments);
      };
      w.gtag('consent', 'default', denied);
      w.gtag('consent', 'update', { ...denied, analytics_storage: 'granted' });
      w.gtag('js', new Date());
      w.gtag('config', measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: window.location.origin + pathname,
        page_referrer: '',
      });
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.appendChild(script);
    } else {
      w.gtag('consent', 'update', { ...denied, analytics_storage: 'granted' });
    }
    if (lastPage.current !== pathname) {
      w.gtag('event', 'page_view', {
        page_location: window.location.origin + pathname,
        page_referrer: '',
        page_title: pathname,
      });
      lastPage.current = pathname;
    }
    let active = true;
    let signup: { method?: unknown; at?: unknown } | null = null;
    try {
      signup = JSON.parse(sessionStorage.getItem(oauthSignupKey) || 'null');
      if (
        !signup ||
        !['google', 'discord'].includes(String(signup.method)) ||
        typeof signup.at !== 'number' ||
        Date.now() - signup.at < 0 ||
        Date.now() - signup.at > 60 * 60 * 1000
      ) {
        clearOAuthSignupIntent();
        signup = null;
      }
    } catch {
      signup = null;
    }
    if (signup) {
      const method = signup.method as 'google' | 'discord';
      const finishHandoff = () => {
        if (pathname === '/oauth-complete')
          window.dispatchEvent(new Event(oauthSignupHandoffFinished));
      };
      void fetch('/api/analytics/oauth-signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ method }),
      })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((result) => {
          if (!result || !['claimed', 'none'].includes(result.status)) {
            finishHandoff();
            return;
          }
          try {
            clearOAuthSignupIntent();
          } catch {
            /* Storage can be unavailable. */
          }
          if (
            result.status === 'claimed' &&
            active &&
            readConsent() === 'accepted' &&
            publicPaths.has(window.location.pathname) &&
            !w[disableKey] &&
            w.gtag
          ) {
            trackPublicEvent(
              'sign_up',
              method,
              pathname === '/oauth-complete' ? finishHandoff : undefined,
            );
          } else finishHandoff();
        })
        .catch(finishHandoff);
    }
    return () => {
      active = false;
      w[disableKey] = true;
      w.gtag?.('consent', 'update', denied);
    };
  }, [pathname, consent, allowed]);
  if (!enabled || !allowed || (consent !== 'unset' && !editing)) return null;
  return (
    <aside className="analytics-banner" aria-label="Analytics preferences">
      <p>May we use analytics cookies to understand visits to our public pages?</p>
      <div>
        <button
          type="button"
          onClick={() => {
            saveConsent('rejected');
            setEditing(false);
          }}
        >
          Reject analytics
        </button>
        <button
          type="button"
          onClick={() => {
            saveConsent('accepted');
            setEditing(false);
          }}
        >
          Accept analytics
        </button>
      </div>
    </aside>
  );
}
