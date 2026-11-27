import Link from 'next/link';
import { AdminDateTime, AdminPageHeading } from '@/components/admin-presentation';
import { adminAccounts, adminPageNumber } from '@/lib/platform-admin';

export default async function AccountsPage({ searchParams }: PageProps<'/admin/accounts'>) {
  const { page: rawPage, search: rawSearch } = await searchParams;
  const page = adminPageNumber(typeof rawPage === 'string' ? rawPage : undefined);
  const search = typeof rawSearch === 'string' ? rawSearch : '';
  const accounts = await adminAccounts(page, search);
  const pageHref = (number: number) =>
    '/admin/accounts?' + new URLSearchParams({ page: String(number), search });
  return (
    <>
      <AdminPageHeading title="Accounts">
        Find registered users and review their workspace counts.
      </AdminPageHeading>
      <section className="card settings-form">
        <form className="admin-filter">
          <label htmlFor="search">Name, email or account ID</label>
          <input id="search" name="search" defaultValue={search} maxLength={254} />
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Created</th>
                <th>Workspaces</th>
              </tr>
            </thead>
            <tbody>
              {accounts.slice(0, 25).map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link href={'/admin/accounts/' + encodeURIComponent(account.id)}>
                      {account.name || account.email}
                    </Link>
                  </td>
                  <td>
                    <AdminDateTime value={account.createdAt} dateOnly />
                  </td>
                  <td>{account._count.ownedWorkspaces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 && <p>No accounts found.</p>}
        <nav aria-label="Account pages" className="admin-pagination">
          {page > 1 && <Link href={pageHref(page - 1)}>Previous</Link>}
          {accounts.length > 25 && <Link href={pageHref(page + 1)}>Next</Link>}
        </nav>
      </section>
    </>
  );
}
