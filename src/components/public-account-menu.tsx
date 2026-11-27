'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  ArrowRight,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Settings2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

type Account = { name?: string | null; email?: string | null };
export function PublicAccountMenu({
  initialAccount = null,
  guestLinks = true,
}: {
  initialAccount?: Account | null;
  guestLinks?: boolean;
}) {
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(initialAccount);
  const [loaded, setLoaded] = useState(Boolean(initialAccount));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Session unavailable');
        const session = await response.json();
        if (active) {
          setAccount(session?.user?.id ? session.user : null);
          setLoaded(true);
        }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError'))
          setLoaded(true);
      }
    }
    void refresh();
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [pathname]);
  if (!loaded && !guestLinks) return null;
  if (!loaded)
    return (
      <>
        <button
          className="public-account-trigger public-account-loading"
          type="button"
          disabled
          aria-label="Loading account"
        >
          <UserRound size={18} aria-hidden="true" />
        </button>
        <noscript>
          <style>{'.public-account-loading{display:none}'}</style>
          <Link href="/login">Sign in</Link>
          <Link className="marketing-button" href="/register">
            Create an account
          </Link>
        </noscript>
      </>
    );
  if (!account && !guestLinks) return null;
  if (!account)
    return (
      <>
        <Link href="/login">Sign in</Link>
        <Link className="marketing-button" href="/register">
          Create an account <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </>
    );
  const name = account.name?.trim() || account.email?.split('@')[0] || 'Your account';
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="public-account-trigger"
        aria-label={`Account menu for ${name}`}
        title={name}
      >
        <span className="public-account-avatar" aria-hidden="true">
          {name.slice(0, 2).toUpperCase()}
        </span>
        <span className="public-account-name">{name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown public-account-dropdown"
          align="end"
          sideOffset={10}
          collisionPadding={16}
        >
          <Dropdown.Label className="public-account-label">
            Signed in as<strong>{name}</strong>
          </Dropdown.Label>
          <Dropdown.Separator className="dropdown-separator" />
          <Dropdown.Item asChild>
            <Link href="/overview">
              <LayoutDashboard size={16} aria-hidden="true" />
              Dashboard
            </Link>
          </Dropdown.Item>
          <Dropdown.Item asChild>
            <Link href="/settings?tab=profile">
              <UserRound size={16} aria-hidden="true" />
              Your profile
            </Link>
          </Dropdown.Item>
          <Dropdown.Item asChild>
            <Link href="/settings">
              <Settings2 size={16} aria-hidden="true" />
              Workspace settings
            </Link>
          </Dropdown.Item>
          <Dropdown.Item asChild></Dropdown.Item>
          <Dropdown.Separator className="dropdown-separator" />
          <Dropdown.Item
            disabled={busy}
            onSelect={(event) => {
              event.preventDefault();
              setBusy(true);
              void signOut({ callbackUrl: '/' }).catch(() => {
                toast.error('Unable to sign out. Please try again.');
                setBusy(false);
              });
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            {busy ? 'Signing out…' : 'Sign out'}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
