import { AdminPageHeading } from '@/components/admin-presentation';
import { adminOverview } from '@/lib/platform-admin';

export default async function AdminPage() {
  const { accounts, workspaces, activeDomains, worker } = await adminOverview();
  return (
    <>
      <AdminPageHeading title="Platform overview">
        Monitor accounts, workspaces and the background worker.
      </AdminPageHeading>
      <section className="card settings-form">
        <h2>Instance activity</h2>
        <dl>
          <dt>Accounts</dt>
          <dd>{accounts.toLocaleString()}</dd>
          <dt>Workspaces</dt>
          <dd>{workspaces.toLocaleString()}</dd>
          <dt>Active domains</dt>
          <dd>{activeDomains.toLocaleString()}</dd>
        </dl>
      </section>
      <section className="card settings-form">
        <h2>Worker</h2>
        <p>{worker.recent ? 'The worker is active.' : 'The worker has not checked in recently.'}</p>
      </section>
    </>
  );
}
