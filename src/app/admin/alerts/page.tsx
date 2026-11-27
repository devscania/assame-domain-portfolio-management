import Link from 'next/link';
import { AdminAlertActions } from '@/components/admin-alert-actions';
import { AdminPagination } from '@/components/admin-pagination';
import {
  AdminDateTime,
  AdminEmptyState,
  AdminPageHeading,
  AdminStatus,
} from '@/components/admin-presentation';
import { listSuspiciousActivity, type AlertFilter } from '@/lib/admin-suspicious-activity';
import { adminPageNumber } from '@/lib/platform-admin';

const labels: Record<string, string> = {
  password_failures: 'Repeated incorrect passwords',
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = adminPageNumber(params.page);
  const status: AlertFilter =
    params.status === 'dismissed' || params.status === 'unread' ? params.status : 'open';
  const alerts = await listSuspiciousActivity(page, status);
  return (
    <>
      <AdminPageHeading title="Suspicious activity alerts" />
      <p className="admin-intro">
        Review accounts with at least five incorrect password attempts in a 15-minute window.
      </p>
      <form action="/admin/alerts" method="get" className="admin-contact-filter">
        <label>
          Alert status{' '}
          <select className="input" name="status" defaultValue={status}>
            <option value="open">Open</option>
            <option value="unread">Unread</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>{' '}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      <section className="admin-section" aria-label="Activity alerts">
        {alerts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">Account</th>
                  <th scope="col">Count</th>
                  <th scope="col">First observed</th>
                  <th scope="col">Last observed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 25).map((alert) => (
                  <tr key={alert.id}>
                    <td>{labels[alert.kind] ?? 'Account activity'}</td>
                    <td>
                      <Link
                        className="text-link"
                        href={`/admin/accounts/${encodeURIComponent(alert.subjectId)}`}
                      >
                        View account
                      </Link>
                    </td>
                    <td>{alert.count}</td>
                    <td>
                      <AdminDateTime value={alert.firstSeenAt} />
                    </td>
                    <td>
                      <AdminDateTime value={alert.lastSeenAt} />
                    </td>
                    <td>
                      <AdminStatus
                        value={alert.dismissedAt ? 'Dismissed' : alert.readAt ? 'Read' : 'Unread'}
                      />
                    </td>
                    <td>
                      {alert.dismissedAt ? (
                        '—'
                      ) : (
                        <AdminAlertActions id={alert.id} isRead={!!alert.readAt} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmptyState>No {status} alerts.</AdminEmptyState>
        )}
        <AdminPagination
          path="/admin/alerts"
          page={page}
          hasNext={alerts.length > 25}
          query={{ status }}
        />
      </section>
    </>
  );
}
