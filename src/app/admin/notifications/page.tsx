import {
  AdminDateTime,
  AdminPageHeading,
  AdminEmptyState,
  AdminStatus,
} from '@/components/admin-presentation';
import Link from 'next/link';
import { z } from 'zod';
import { AdminPagination } from '@/components/admin-pagination';
import { AdminNotificationReview } from '@/components/admin-notification-review';
import { AdminNotificationRetry } from '@/components/admin-notification-retry';
import { notificationOperations, type NoticeKind } from '@/lib/admin-notification-operations';
import { adminPageNumber } from '@/lib/platform-admin';

const reviewDetail = z.object({
  outcome: z.enum(['delivered', 'not_delivered', 'unresolved']),
  caseReference: z.string().max(80),
  observedStatus: z.enum(['sending', 'failed']),
});
export default async function NotificationOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = adminPageNumber(params.page);
  const status = params.status === 'sending' ? 'sending' : 'failed';
  const data = await notificationOperations(page, status);
  const sections = [
    { key: 'renewal' as const, title: 'Renewal reminders', items: data.renewal },
    { key: 'welcome' as const, title: 'Welcome messages', items: data.welcome },
  ];
  return (
    <>
      <AdminPageHeading title="Notification operations" />
      <p className="admin-intro">
        Review failed or potentially in-flight deliveries. Reviews record operator evidence. A
        failed renewal delivery with a current non-delivery review may be queued once for retry;
        welcome messages and uncertain or in-flight deliveries cannot be retried here. Verify the
        mail provider&apos;s evidence before proceeding.
      </p>
      <form action="/admin/notifications" method="get" className="admin-contact-filter">
        <label>
          Delivery state{' '}
          <select className="input" name="status" defaultValue={status}>
            <option value="failed">Failed</option>
            <option value="sending">Sending or uncertain</option>
          </select>
        </label>{' '}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      {sections.map((section) => (
        <section className="admin-section" key={section.key}>
          <h2>{section.title}</h2>
          {section.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Account</th>
                    <th>Created</th>
                    <th>State</th>
                    <th>Latest review</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.slice(0, 25).map((item) => {
                    const audit = data.audits.find(
                      (entry) =>
                        entry.resourceId === item.id &&
                        entry.action === `notification.${section.key}.reviewed`,
                    );
                    const review = reviewDetail.safeParse(audit?.detail);
                    const retried = data.audits.some(
                      (entry) =>
                        entry.resourceId === item.id &&
                        entry.action === `notification.${section.key}.retry_queued`,
                    );
                    return (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>
                          <Link
                            className="text-link"
                            href={`/admin/accounts/${encodeURIComponent(item.ownerId)}`}
                          >
                            View account
                          </Link>
                        </td>
                        <td>
                          <AdminDateTime value={item.createdAt} />
                        </td>
                        <td>
                          <AdminStatus value={item.status} />
                        </td>
                        <td>
                          {review.success
                            ? `${review.data.outcome.replaceAll('_', ' ')} · ${review.data.caseReference} · ${audit!.createdAt.toISOString()}`
                            : 'No review recorded'}
                        </td>
                        <td>
                          <AdminNotificationReview
                            kind={section.key as NoticeKind}
                            id={item.id}
                            status={status}
                          />
                          {section.key !== 'welcome' &&
                            status === 'failed' &&
                            review.success &&
                            review.data.observedStatus === 'failed' &&
                            review.data.outcome === 'not_delivered' &&
                            audit &&
                            !retried && (
                              <AdminNotificationRetry
                                kind={section.key}
                                id={item.id}
                                reviewId={audit.id}
                              />
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <AdminEmptyState>No {status} deliveries on this page.</AdminEmptyState>
          )}
        </section>
      ))}
      <section className="admin-section">
        <h2>Security notices</h2>
        <p>
          Uncertain password notices are not automatically resent. Check delivery with the mail
          provider.
        </p>
        {data.security.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Account</th>
                  <th>Created</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {data.security.slice(0, 25).map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>
                      <Link
                        className="text-link"
                        href={`/admin/accounts/${encodeURIComponent(item.ownerId)}`}
                      >
                        View account
                      </Link>
                    </td>
                    <td>
                      <AdminDateTime value={item.createdAt} />
                    </td>
                    <td>
                      <AdminStatus value={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmptyState>No {status} security notices on this page.</AdminEmptyState>
        )}
      </section>
      <AdminPagination
        path="/admin/notifications"
        page={page}
        hasNext={sections.some((section) => section.items.length > 25) || data.security.length > 25}
        query={{ status }}
      />
    </>
  );
}
