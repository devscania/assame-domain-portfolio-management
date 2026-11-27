'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  defaultActivityEmailPreferences,
  type ActivityEmailPreferences,
} from '@/lib/activity-email-policy';

type Theme = 'light' | 'dark' | 'system';
type Status = 'loading' | 'authenticated' | 'anonymous' | 'error';
type Appearance = {
  changeTheme: (theme: Theme) => void;
  notifications: boolean;
  renewalEmails: boolean;
  renewalEmailsAvailable: boolean;
  activityEmails: boolean;
  activityEmailsAvailable: boolean;
  activityEmailPreferences: ActivityEmailPreferences;
  status: Status;
  saveNotifications: (
    value: boolean,
    renewalEmails?: boolean,
    activityEmails?: boolean,
    activityEmailPreferences?: ActivityEmailPreferences,
  ) => Promise<void>;
};
const AppearanceContext = createContext<Appearance | null>(null);
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('Appearance provider missing');
  return value;
}
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const themeSetter = useRef(setTheme);
  useEffect(() => {
    themeSetter.current = setTheme;
  }, [setTheme]);
  const [status, setStatus] = useState<Status>('loading');
  const [notifications, setNotifications] = useState(true);
  const [renewalEmails, setRenewalEmails] = useState(false);
  const [renewalEmailsAvailable, setRenewalEmailsAvailable] = useState(false);
  const [activityEmails, setActivityEmails] = useState(false);
  const [activityEmailPreferences, setActivityEmailPreferences] = useState(
    defaultActivityEmailPreferences,
  );
  const [activityEmailsAvailable, setActivityEmailsAvailable] = useState(false);
  const state = useRef<Status>('loading');
  const pendingTheme = useRef<Theme | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const writeTheme = useCallback((theme: Theme) => {
    writes.current = writes.current
      .then(async () => {
        const response = await fetch('/api/account/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme }),
        });
        if (!response.ok) throw new Error('Unable to save appearance to your account.');
      })
      .catch(() => {
        toast.error('Unable to save appearance to your account.');
      });
  }, []);
  useEffect(() => {
    // next-themes changes setTheme identity when the theme changes. Reloading here
    // can replace a new local choice with the account value before its PATCH completes.
    let active = true;
    void fetch('/api/account/preferences', { cache: 'no-store' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          state.current = 'anonymous';
          setStatus('anonymous');
          return;
        }
        if (!response.ok) throw new Error('Preferences unavailable');
        const preference = (await response.json()) as {
          theme: Theme | null;
          notifications: boolean;
          renewalEmails: boolean;
          renewalEmailsAvailable: boolean;
          activityEmails: boolean;
          activityEmailsAvailable: boolean;
        } & ActivityEmailPreferences;
        if (!active) return;
        state.current = 'authenticated';
        setStatus('authenticated');
        setNotifications(preference.notifications);
        setRenewalEmails(preference.renewalEmails);
        setRenewalEmailsAvailable(preference.renewalEmailsAvailable);
        setActivityEmails(preference.activityEmails);
        setActivityEmailPreferences({
          activityBulkEmails: preference.activityBulkEmails ?? true,
          activityPriceEmails: preference.activityPriceEmails ?? true,
          activitySyncEmails: preference.activitySyncEmails ?? true,
        });
        setActivityEmailsAvailable(preference.activityEmailsAvailable);
        if (pendingTheme.current) {
          writeTheme(pendingTheme.current);
          pendingTheme.current = null;
        } else if (preference.theme) themeSetter.current(preference.theme);
      })
      .catch(() => {
        if (active) {
          state.current = 'error';
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [writeTheme]);
  const changeTheme = useCallback(
    (value: Theme) => {
      setTheme(value);
      if (state.current === 'loading') pendingTheme.current = value;
      else if (state.current === 'authenticated') writeTheme(value);
      else if (state.current === 'error')
        toast.error('Appearance changed locally; account preferences are unavailable.');
    },
    [setTheme, writeTheme],
  );
  const saveNotifications = useCallback(
    async (
      value: boolean,
      renewalEmails?: boolean,
      activityEmails?: boolean,
      emailOptions?: ActivityEmailPreferences,
    ) => {
      const response = await fetch('/api/account/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifications: value,
          renewalEmails,
          activityEmails,
          ...emailOptions,
        }),
      });
      if (!response.ok) throw new Error('Unable to save notification preference.');
      setNotifications(value);
      if (renewalEmails !== undefined) setRenewalEmails(renewalEmails);
      if (activityEmails !== undefined) setActivityEmails(activityEmails);
      if (emailOptions) setActivityEmailPreferences(emailOptions);
    },
    [],
  );
  return (
    <AppearanceContext.Provider
      value={{
        changeTheme,
        notifications,
        renewalEmails,
        renewalEmailsAvailable,
        activityEmails,
        activityEmailsAvailable,
        activityEmailPreferences,
        status,
        saveNotifications,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
