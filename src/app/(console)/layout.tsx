import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAppError } from '@/lib/security';
import { context } from '@/lib/access';
import { Shell } from '@/components/shell';
import { brand } from '@/lib/brand';
import { db } from '@/lib/db';
import { isPlatformAdmin } from '@/lib/platform-admin';
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await context().catch((error: unknown) => {
    if (isAppError(error) && error.status === 401) redirect('/login');
    if (isAppError(error) && error.status === 403 && error.message === 'Workspace unavailable')
      return null;
    throw error;
  });
  if (!ctx)
    return (
      <main className="page-content">
        <section className="card settings-form">
          <h1>Your workspace needs attention</h1>
          <p>Your sign-in succeeded, but no available workspace was found for your account.</p>
          <p>Contact Assame for help restoring access to your portfolio.</p>
          <Link className="btn btn-primary" href="/contact">
            Contact support
          </Link>
          <Link className="text-link" href="/">
            Return to home
          </Link>
        </section>
      </main>
    );
  const account = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { name: true, email: true, emailVerified: true },
  });
  const platformAdmin = isPlatformAdmin(ctx.user.id) && Boolean(account?.emailVerified);
  return (
    <Shell
      brand={brand.name}
      platformAdmin={platformAdmin}
      user={{ name: account?.name || 'Investor', email: account?.email || '' }}
      workspace={{
        id: ctx.org.id,
        name: ctx.org.name,
        demo: ctx.org.demo,
        currency: ctx.org.currency,
        role: ctx.role,
        workspaceOwner: ctx.org.workspaceOwnerId === ctx.user.id,
        pricePublishingAvailable: process.env.PROVIDER_WRITES_ENABLED === 'true' && !ctx.org.demo,
        pricePublishingEnabled: ctx.org.pricePublishingEnabled,
        providerActionsEnabled: ctx.org.providerActionsEnabled,
      }}
      workspaces={ctx.members.map((m) => ({ id: m.organizationId, name: m.organization.name }))}
    >
      {children}
    </Shell>
  );
}
