'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navigation = [
  ['/features', 'Features'],
  ['/integrations', 'Integrations'],
  ['/faq', 'FAQ'],
  ['/blog', 'Resources'],
] as const;

export function PublicNavigation() {
  const pathname = usePathname() || '';
  return (
    <nav aria-label="Main navigation">
      {navigation.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
