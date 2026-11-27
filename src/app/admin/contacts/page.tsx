import { AdminDateTime, AdminPageHeading, AdminEmptyState } from '@/components/admin-presentation';
import { adminContacts, adminPageNumber } from '@/lib/platform-admin';
import { AdminPagination } from '@/components/admin-pagination';
import { AdminContactStatus } from '@/components/admin-contact-status';
import { contactStatuses, contactStatusLabels, type ContactStatus } from '@/lib/contact-status';
import { contactKinds } from '@/lib/contact-kind';
const feedbackLabels: Record<string, string> = {
  contact: 'Contact request',
  bug: 'Bug report',
  feature: 'Feature request',
};
export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const page = adminPageNumber(params.page);
  const filter = contactStatuses.find((status) => status === params.status);
  const kind = contactKinds.find((value) => value === params.kind);
  const requests = await adminContacts(page, filter, kind);
  return (
    <>
      <AdminPageHeading title="Contact requests" />
      <p className="admin-intro">Review contact submissions, bug reports, and feature requests.</p>
      <form action="/admin/contacts" method="get" className="admin-contact-filter">
        <label>
          Filter by status{' '}
          <select name="status" className="input" defaultValue={filter || ''}>
            <option value="">All</option>
            {contactStatuses.map((status) => (
              <option key={status} value={status}>
                {contactStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Request type{' '}
          <select name="kind" className="input" defaultValue={kind || ''}>
            <option value="">All</option>
            <option value="contact">Contact requests</option>
            <option value="bug">Bug reports</option>
            <option value="feature">Feature requests</option>
          </select>
        </label>{' '}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      {requests.length ? (
        requests.slice(0, 25).map((item) => (
          <article className="admin-contact" key={item.id}>
            <h2>
              {item.name} · {feedbackLabels[item.kind] ?? 'Contact request'}
            </h2>
            <p>
              {item.email} · <AdminDateTime value={item.createdAt} /> ·{' '}
              {contactStatuses.includes(item.status as ContactStatus)
                ? contactStatusLabels[item.status as ContactStatus]
                : item.status}
            </p>
            <p className="admin-message">{item.message}</p>

            {contactStatuses.includes(item.status as ContactStatus) ? (
              <AdminContactStatus
                key={`${item.id}:${item.status}`}
                id={item.id}
                name={item.name}
                initial={item.status as ContactStatus}
              />
            ) : (
              <p>Unknown status; contact an administrator.</p>
            )}
          </article>
        ))
      ) : (
        <AdminEmptyState>No requests on this page.</AdminEmptyState>
      )}
      <AdminPagination
        path="/admin/contacts"
        page={page}
        hasNext={requests.length > 25}
        query={{ ...(filter ? { status: filter } : {}), ...(kind ? { kind } : {}) }}
      />
    </>
  );
}
