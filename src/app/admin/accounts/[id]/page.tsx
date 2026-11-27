import Link from 'next/link';
import { AdminDateTime, AdminPageHeading } from '@/components/admin-presentation';
import { adminAccount } from '@/lib/platform-admin';

export default async function AccountPage({ params }: PageProps<'/admin/accounts/[id]'>) {
  const { id } = await params;
  const account = await adminAccount(id);
  return (
    <>
      <AdminPageHeading title="Account details">{account.name || account.email}</AdminPageHeading>
      <section className="card settings-form">
        <dl>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Registered</dt>
          <dd>
            <AdminDateTime value={account.createdAt} dateOnly />
          </dd>
          <dt>Verified</dt>
          <dd>
            {account.emailVerified ? (
              <AdminDateTime value={account.emailVerified} dateOnly />
            ) : (
              'Pending'
            )}
          </dd>
          <dt>Owned workspaces</dt>
          <dd>{account._count.ownedWorkspaces}</dd>
        </dl>
        <Link href="/admin/accounts">Back to accounts</Link>
      </section>
    </>
  );
}
