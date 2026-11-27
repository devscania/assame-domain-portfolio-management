'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  Activity,
  BellRing,
  Bell,
  LayoutDashboard,
  LifeBuoy,
  ShieldCheck,
  Users,
} from 'lucide-react';

const navigation = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/accounts', label: 'Accounts', icon: Users },
  { href: '/admin/contacts', label: 'Contact requests', icon: LifeBuoy },
  { href: '/admin/alerts', label: 'Alerts', icon: BellRing },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell },
  { href: '/admin/audit', label: 'Audit log', icon: Activity },
];

export function AdminNavigation() {
  const pathname = usePathname();
  const links = useRef<HTMLDivElement>(null);
  const { data: unread = 0 } = useQuery({
    queryKey: ['admin-unread-alerts'],
    queryFn: async () => {
      const response = await fetch('/api/admin/alerts');
      if (!response.ok) throw new Error('Alerts unavailable');
      return ((await response.json()) as { unread: number }).unread;
    },
    refetchInterval: 30000,
    retry: false,
  });
  useEffect(() => {
    const container = links.current;
    const current = container?.querySelector<HTMLAnchorElement>('[aria-current="page"]');
    if (!container || !current || container.scrollWidth <= container.clientWidth) return;
    const left =
      current.getBoundingClientRect().left -
      container.getBoundingClientRect().left +
      container.scrollLeft;
    // Keep the selected mobile destination visible without shifting the page.
    container.scrollTo({
      left: Math.max(0, left - (container.clientWidth - current.offsetWidth) / 2),
      behavior: 'instant',
    });
  }, [pathname]);
  return (
    <nav className="admin-navigation" aria-label="Platform administration">
      <span className="admin-nav-label">Manage platform</span>
      <div className="admin-nav-links" ref={links}>
        {navigation.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/admin'
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link href={href} key={href} aria-current={active ? 'page' : undefined}>
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              {href === '/admin/alerts' && unread > 0 && (
                <span className="admin-alert-count" aria-label={`${unread} unread alerts`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="admin-access-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          Restricted access
          <br />
          <small>Administrator activity is audited</small>
        </span>
      </div>
    </nav>
  );
}
