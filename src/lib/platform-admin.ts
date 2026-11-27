import { activeDomain } from '@/lib/workspace-owner';
import type { ContactKind } from '@/lib/contact-kind';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { contactStatuses, type ContactStatus } from '@/lib/contact-status';
import { workerDispatchHealth } from '@/lib/worker-health';
export { contactStatuses } from '@/lib/contact-status';

/** Deployment-owned user IDs, never workspace roles or email-address matching. */
export function isPlatformAdmin(userId: string | undefined) {
  return (
    !!userId &&
    (process.env.PLATFORM_ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(userId)
  );
}
export async function platformAdminActor() {
  const session = await auth();
  if (!isPlatformAdmin(session?.user?.id)) throw new AppError('Not found', 404);
  const user = await db.user.findUnique({
    where: { id: session!.user!.id! },
    select: { emailVerified: true },
  });
  if (!user?.emailVerified) throw new AppError('Not found', 404);
  return session!.user!.id!;
}
export async function requirePlatformAdmin() {
  try {
    return await platformAdminActor();
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
type AdminAction =
  'overview.view' | 'accounts.view' | 'account.view' | 'contacts.view' | 'audit.view';
export async function recordView(action: AdminAction, resourceId?: string) {
  const actorId = await requirePlatformAdmin();
  await db.platformAdminAudit.create({ data: { actorId, action, resourceId } });
}
export function adminPageNumber(value: string | undefined) {
  return value && /^\d{1,4}$/.test(value) ? Math.max(1, Math.min(Number(value), 1000)) : 1;
}

/** The audit table can contain evolving JSON fields. Expose only known operational fields. */
export function safeAuditDetail(action: string, detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const data = detail as Record<string, unknown>;
  const pick = (input: unknown, keys: string[]) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (input as Record<string, unknown>)[key];
      if (
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
        result[key] = value;
      else if (typeof value === 'string' && value.length <= 120) result[key] = value;
    }
    return result;
  };
  if (/^notification\.(renewal|welcome)\.(reviewed|retry_queued)$/.test(action))
    return pick(data, ['reviewId', 'caseReference', 'observedStatus', 'outcome']);
  return null;
}

export async function adminAudit(page: number, category: 'all' | 'changes' = 'all') {
  await recordView('audit.view');
  const rows = await db.platformAdminAudit.findMany({
    where: category === 'changes' ? { NOT: { action: { endsWith: '.view' } } } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * 25,
    take: 26,
    select: {
      id: true,
      actorId: true,
      action: true,
      resourceId: true,
      detail: true,
      createdAt: true,
    },
  });
  return rows.map(({ detail, ...row }) => ({
    ...row,
    detail: safeAuditDetail(row.action, detail),
  }));
}
export async function adminOverview() {
  await recordView('overview.view');
  const [accounts, workspaces, activeDomains, worker] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.organization.count(),
    db.domain.count({ where: activeDomain }),
    workerDispatchHealth(),
  ]);
  return { accounts, workspaces, activeDomains, worker };
}

export async function adminAccounts(page: number, search?: string) {
  await recordView('accounts.view');
  const query = search?.trim().slice(0, 254);
  const literal = query?.replace(/[\\%_]/g, '\\$&');
  return db.user.findMany({
    where: literal
      ? {
          OR: [
            { name: { contains: literal, mode: 'insensitive' } },
            { email: { contains: literal, mode: 'insensitive' } },
            { id: query },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * 25,
    take: 26,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      _count: { select: { ownedWorkspaces: true } },
    },
  });
}

export async function adminAccount(id: string) {
  await recordView('account.view', id);
  const account = await db.user.findUnique({
    where: { id },
    select: {
      name: true,
      email: true,
      createdAt: true,
      emailVerified: true,
      _count: { select: { ownedWorkspaces: true } },
    },
  });
  if (!account) notFound();
  return account;
}

export async function adminContacts(page: number, status?: ContactStatus, kind?: ContactKind) {
  await recordView('contacts.view');
  return db.contactRequest.findMany({
    where: { status, kind },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * 25,
    take: 26,
    select: {
      id: true,
      name: true,
      email: true,
      message: true,
      kind: true,
      status: true,
      createdAt: true,
    },
  });
}

/** Change triage state and write its audit entry in one transaction. */
export async function updateContactStatus(
  id: string,
  expected: ContactStatus,
  next: ContactStatus,
) {
  const actorId = await platformAdminActor();
  if (!contactStatuses.includes(expected) || !contactStatuses.includes(next))
    throw new AppError('Invalid status.', 400);
  if (expected === next) throw new AppError('Choose a different status.', 400);
  await throttle(`platform-contact-status:${actorId}`, 100);
  await db.$transaction(async (tx) => {
    // Serialize the authorization recheck with account verification or removal.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { emailVerified: true },
    });
    if (!isPlatformAdmin(actorId) || !actor?.emailVerified) throw new AppError('Not found', 404);
    const result = await tx.contactRequest.updateMany({
      where: { id, status: expected },
      data: { status: next },
    });
    if (result.count !== 1)
      throw new AppError('Request status changed or is unavailable. Refresh and try again.', 409);
    // The action records only the transition; the message and email never enter the audit log.
    await tx.platformAdminAudit.create({
      data: { actorId, action: `contact.status.${expected}.${next}`, resourceId: id },
    });
  });
  return { status: next };
}
