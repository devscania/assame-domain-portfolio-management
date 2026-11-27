'use client';
import { Fragment, createContext, useContext, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PublicAccountMenu } from './public-account-menu';
import { PublicTheme } from './public-theme';
import { useAppearance } from './appearance';
import { signOut } from 'next-auth/react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  Activity,
  ArrowUpRight,
  Bell,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Command,
  Globe2,
  LayoutDashboard,
  Layers3,
  Link2,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, read, type Summary } from './client';
import { Button, Modal, Field, Input } from './ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
export type Workspace = {
  id: string;
  name: string;
  demo: boolean;
  currency: string;
  role: string;
  workspaceOwner: boolean;
  pricePublishingAvailable: boolean;
  pricePublishingEnabled: boolean;
  providerActionsEnabled: boolean;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export const useWorkspace = () => useContext(WorkspaceContext)!;
const nav = [
  { label: 'Overview', path: '/overview', icon: LayoutDashboard },
  { label: 'My Domains', path: '/domains', icon: Globe2 },
  { label: 'Marketplace Listings', path: '/listings', icon: Store },
  { label: 'Registrars', path: '/registrars', icon: Layers3 },
  { label: 'Sales & Revenue', path: '/sales', icon: Wallet },
  { label: 'Renewals', path: '/renewals', icon: CalendarClock },
  { label: 'Analytics', path: '/analytics', icon: ChartNoAxesCombined },
  { label: 'Activity Center', path: '/sync', icon: Activity },
  { label: 'Integrations', path: '/connections', icon: Link2 },
];
export function Shell({
  children,
  user,
  workspace,
  workspaces,
  brand,
  platformAdmin,
}: {
  children: React.ReactNode;
  user: { name: string; email: string };
  workspace: Workspace;
  workspaces: { id: string; name: string }[];
  brand: string;
  platformAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { notifications: notificationsEnabled } = useAppearance();
  const queryClient = useQueryClient();
  const [mobile, setMobile] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobile(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobile]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const { data } = useQuery({
    queryKey: ['summary'],
    queryFn: () => read<Summary>('view=summary'),
  });
  const { data: activityUnread } = useQuery({
    queryKey: ['activity-unread', workspace.id],
    queryFn: () => read<{ count: number }>('view=activityUnread'),
    enabled: notificationsEnabled,
    refetchInterval: 30000,
  });
  const unreadActivityCount = notificationsEnabled ? (activityUnread?.count ?? 0) : 0;
  async function switchWorkspace(id: string) {
    try {
      await api('workspace.switch', { id });
      window.location.assign('/overview');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="app-layout">
        {mobile && <div className="sidebar-backdrop" onClick={() => setMobile(false)} />}
        <aside id="workspace-navigation" className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
          <Link href="/" className="brand">
            <span className="brand-mark">
              <Layers3 size={22} />
            </span>
            <span>{brand}</span>
            <span className="brand-dot">.</span>
          </Link>
          <div className="sidebar-caption">WORKSPACE</div>
          <nav aria-label="Workspace navigation">
            {nav.map((item, i) => (
              <Fragment key={item.path}>
                {i === 7 && <span className="sidebar-group-label">Connections & automation</span>}
                <Link
                  onClick={() => setMobile(false)}
                  className={`nav-item ${pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path)) ? 'nav-active' : ''}`}
                  aria-current={
                    pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
                      ? 'page'
                      : undefined
                  }
                  href={item.path}
                  aria-describedby={
                    item.path === '/sync' && unreadActivityCount
                      ? 'activity-unread-description'
                      : undefined
                  }
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.path === '/sync' && unreadActivityCount > 0 && (
                    <>
                      <span className="nav-count" aria-hidden="true">
                        {unreadActivityCount}
                      </span>
                      <span className="sr-only" id="activity-unread-description">
                        {unreadActivityCount} unread workspace activity items
                      </span>
                    </>
                  )}
                </Link>
              </Fragment>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Link
              className={`nav-item ${pathname === '/settings' ? 'nav-active' : ''}`}
              href="/settings"
              aria-current={pathname === '/settings' ? 'page' : undefined}
              onClick={() => setMobile(false)}
            >
              <Settings2 size={18} />
              Settings
            </Link>
            <Link className="nav-item" href="/integrations">
              <CircleHelp size={18} />
              Provider guides
              <ArrowUpRight size={13} />
            </Link>
            <Link className="nav-item" href="/contact" onClick={() => setMobile(false)}>
              <CircleHelp size={18} />
              Help &amp; feedback
              <ArrowUpRight size={13} />
            </Link>
            <div className="sidebar-profile">
              <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{user.name}</strong>
                <small>{workspace.role.toLowerCase()} account</small>
              </div>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <Button variant="ghost" aria-label="Account menu">
                    <ChevronDown size={15} />
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content className="dropdown" side="right" sideOffset={12}>
                    <Dropdown.Label className="dropdown-label">{user.email}</Dropdown.Label>
                    <Dropdown.Item asChild>
                      <Link href="/settings?tab=profile">Account profile</Link>
                    </Dropdown.Item>
                    <Dropdown.Item asChild>
                      <Link href="/settings?tab=workspaces">Workspaces</Link>
                    </Dropdown.Item>
                    <Dropdown.Item asChild>
                      <Link href="/settings?tab=security">Account security</Link>
                    </Dropdown.Item>
                    {platformAdmin && (
                      <Dropdown.Item asChild>
                        <Link href="/admin">Platform administration</Link>
                      </Dropdown.Item>
                    )}
                    <Dropdown.Item onSelect={() => void signOut({ callbackUrl: '/login' })}>
                      <LogOut size={15} />
                      Sign out
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <Button
              ref={menuRef}
              variant="ghost"
              className="mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
            >
              {mobile ? <X size={20} /> : <Menu size={20} />}
            </Button>
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button className="workspace-switch">
                  <span className="workspace-icon">{workspace.name[0]}</span>
                  <strong>{workspace.name}</strong>
                  <ChevronDown size={14} />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content className="dropdown" sideOffset={12}>
                  <Dropdown.Label className="dropdown-label">YOUR WORKSPACES</Dropdown.Label>
                  {workspaces.map((w) => (
                    <Dropdown.Item key={w.id} onSelect={() => void switchWorkspace(w.id)}>
                      {w.name}
                      {w.id === workspace.id && <span className="ml-auto text-teal-600">✓</span>}
                    </Dropdown.Item>
                  ))}
                  <Dropdown.Separator />
                  <Dropdown.Item onSelect={() => setCreate(true)}>
                    <Plus size={16} />
                    Create workspace
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
            <span className="top-divider" />
            <form
              method="post"
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = new FormData(e.currentTarget).get('q');
                router.push(`/domains?q=${encodeURIComponent(String(q))}`);
              }}
            >
              <Search size={17} />
              <input
                ref={searchRef}
                name="q"
                aria-label="Search your domains"
                placeholder="Search your domains…"
              />
              <span className="keycap">
                <Command size={10} /> K
              </span>
            </form>
            <div className="topbar-right">
              <PublicTheme />
              <button
                className="notification-button"
                aria-label="Notifications"
                onClick={() => setNotifications(true)}
              >
                <Bell size={19} />
                {notificationsEnabled && !!data?.notifications.length && <span />}
              </button>
              <PublicAccountMenu initialAccount={user} />
            </div>
          </header>
          {workspace.demo && (
            <div className="demo-strip">
              <span>
                <span className="demo-dot" /> DEMO WORKSPACE
              </span>
              Explore a synthetic portfolio. Provider accounts are disconnected.
              <Link href="/settings">
                Create a real workspace <ArrowUpRight size={12} />
              </Link>
            </div>
          )}
          <main className="page-content">{children}</main>
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()} {brand}
            </span>
            <span>
              <ShieldCheck size={13} /> Read-only provider access by default
            </span>
          </footer>
        </div>
      </div>
      <Modal
        title="Notifications"
        description="Workspace updates and reminders."
        open={notifications}
        onOpenChange={setNotifications}
      >
        {!notificationsEnabled ? (
          <p className="muted p-4">
            In-app notifications are off.{' '}
            <Link href="/settings?tab=preferences" onClick={() => setNotifications(false)}>
              Change preferences
            </Link>
            .
          </p>
        ) : data?.notifications.length ? (
          <div className="stack">
            {data.notifications.map((n) => (
              <div className="notice" key={n.id}>
                {n.title}
              </div>
            ))}
            <Button
              onClick={async () => {
                await api('notifications.read', {
                  ids: data.notifications.map((notice) => notice.id),
                });
                await queryClient.invalidateQueries({ queryKey: ['summary'] });
                setNotifications(false);
              }}
            >
              Mark shown as read
            </Button>
          </div>
        ) : (
          <p className="muted p-4">You’re all caught up.</p>
        )}
      </Modal>
      <Modal
        title="Create workspace"
        description="Keep each portfolio and its connections separate."
        open={create}
        onOpenChange={setCreate}
      >
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const form = new FormData(e.currentTarget);
            try {
              const org = await api<{ id: string }>('workspace.create', {
                name: form.get('name'),
              });
              await switchWorkspace(org.id);
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Workspace name">
            <Input name="name" required placeholder="My investment portfolio" />
          </Field>
          <Button variant="primary" disabled={busy}>
            Create workspace
          </Button>
        </form>
      </Modal>
    </WorkspaceContext.Provider>
  );
}
