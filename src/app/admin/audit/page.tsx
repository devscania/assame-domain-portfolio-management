import { AdminDateTime, AdminPageHeading, AdminEmptyState } from '@/components/admin-presentation';
import { AdminPagination } from '@/components/admin-pagination';
import { adminAudit, adminPageNumber } from '@/lib/platform-admin';

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  const params = await searchParams;
  const page = adminPageNumber(params.page);
  const category = params.category === 'changes' ? 'changes' : 'all';
  const entries = await adminAudit(page, category);
  return (
    <>
      <AdminPageHeading title="Platform audit log" />
      <p className="admin-intro">
        Review platform administrator activity. Times are UTC. Each visit to this page is recorded.
        Provider credentials, payment payloads and contact messages are not displayed.
      </p>
      <form action="/admin/audit" method="get" className="admin-contact-filter">
        <label>
          Activity{' '}
          <select name="category" className="input" defaultValue={category}>
            <option value="all">All activity</option>
            <option value="changes">Changes and reviews</option>
          </select>
        </label>{' '}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      {entries.length ? (
        entries.slice(0, 25).map((entry) => (
          <article className="admin-contact" key={entry.id}>
            <h2>{entry.action}</h2>
            <p>
              <AdminDateTime value={entry.createdAt} /> · Actor ID: {entry.actorId}
            </p>
            {entry.resourceId && <p>Resource ID: {entry.resourceId}</p>}
            {entry.detail && (
              <pre className="admin-message">{JSON.stringify(entry.detail, null, 2)}</pre>
            )}
          </article>
        ))
      ) : (
        <AdminEmptyState>No audit entries on this page.</AdminEmptyState>
      )}
      <AdminPagination
        path="/admin/audit"
        page={page}
        hasNext={entries.length > 25}
        query={category === 'changes' ? { category } : undefined}
      />
    </>
  );
}
