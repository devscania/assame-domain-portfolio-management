import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { PublicAccountMenu } from '@/components/public-account-menu';
import { PublicTheme } from '@/components/public-theme';
import { AdminNavigation } from '@/components/admin-navigation';
import { ArrowLeft, Layers3 } from 'lucide-react';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Platform administration',
  robots: { index: false, follow: false },
};
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="admin-layout admin-console">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          <span>
            <Layers3 size={23} aria-hidden="true" />
          </span>
          <div>
            Assame<small>Platform administration</small>
          </div>
        </Link>
        <AdminNavigation />
        <div className="admin-sidebar-footer">
          <span>Appearance</span>
          <PublicTheme />
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <Link href="/overview">
            <ArrowLeft size={15} aria-hidden="true" />
            Back to workspace
          </Link>
          <PublicAccountMenu guestLinks={false} />
        </header>
        <main className="admin-main" id="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}
