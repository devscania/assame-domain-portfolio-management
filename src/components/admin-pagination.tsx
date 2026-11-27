import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
export function AdminPagination({
  path,
  page,
  hasNext,
  query,
}: {
  path: string;
  page: number;
  hasNext: boolean;
  query?: Record<string, string>;
}) {
  const pageUrl = (value: number) =>
    `${path}?${new URLSearchParams({ ...query, page: String(value) })}`;
  return (
    <nav className="admin-pagination" aria-label="Pages">
      {page > 1 ? (
        <Link className="text-link" href={pageUrl(page - 1)}>
          <ChevronLeft size={14} aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span className="admin-pagination-disabled">
          <ChevronLeft size={14} aria-hidden="true" />
          Previous
        </span>
      )}
      <span aria-current="page">Page {page}</span>
      {hasNext && page < 1000 ? (
        <Link className="text-link" href={pageUrl(page + 1)}>
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      ) : (
        <span className="admin-pagination-disabled">
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
