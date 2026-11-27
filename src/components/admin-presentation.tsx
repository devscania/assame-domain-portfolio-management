import { CheckCheck, Inbox, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export function AdminPageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="admin-page-heading">
      <div>
        <span className="admin-eyebrow">Platform administration</span>
        <h1>{title}</h1>
        {children}
      </div>
      <span className="admin-heading-icon">
        <ShieldCheck size={24} aria-hidden="true" />
      </span>
    </div>
  );
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="admin-empty">
      <span>
        <Inbox size={22} aria-hidden="true" />
      </span>
      <p>{children}</p>
    </div>
  );
}

export function AdminStatus({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll(' ', '_');
  const tone = ['active', 'completed', 'processed', 'confirmed', 'verified', 'resolved'].includes(
    normalized,
  )
    ? 'success'
    : ['failed', 'needs_review', 'declined', 'reversed'].includes(normalized)
      ? 'danger'
      : [
            'pending',
            'approval_pending',
            'approved',
            'sending',
            'uncertain',
            'awaiting_approval',
            'in_progress',
          ].includes(normalized)
        ? 'warning'
        : 'neutral';
  return (
    <span className="admin-status" data-tone={tone}>
      {tone === 'success' ? <CheckCheck size={12} aria-hidden="true" /> : <i aria-hidden="true" />}
      {value}
    </span>
  );
}

export function AdminDateTime({
  value,
  dateOnly = false,
}: {
  value: Date | null | undefined;
  dateOnly?: boolean;
}) {
  if (!value) return <span className="admin-unrecorded">Not recorded</span>;
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' as const }),
    timeZone: 'UTC',
  }).format(value);
  return (
    <time className="admin-time" dateTime={value.toISOString()} title={value.toISOString()}>
      {formatted}
      {dateOnly ? '' : ' UTC'}
    </time>
  );
}
