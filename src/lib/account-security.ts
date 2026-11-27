import { hash, verify } from 'argon2';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { queuePasswordChangedNotice } from './security-notices';
import { AppError } from './security';
import { throttle } from './throttle';

export async function changeAccountPassword(
  userId: string,
  currentPassword: string,
  password: string,
  address: string,
  onChanged?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  await throttle(`password-change:${userId}`, 10);
  await throttle(`password-change-address:${address}`, 50);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true, sessionVersion: true },
  });
  if (!user?.passwordHash || !(await verify(user.passwordHash, currentPassword).catch(() => false)))
    throw new AppError('Current password is incorrect', 400);
  const passwordHash = await hash(password, { type: 2 });
  await db.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, sessionVersion: user.sessionVersion },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new AppError('Your account changed. Sign in and try again.', 409);
    await tx.accountLoginSession.deleteMany({ where: { userId: user.id } });
    await tx.authToken.deleteMany({
      where: { userId: user.id, OR: [{ kind: 'reset' }, { kind: { startsWith: 'setup:' } }] },
    });
    await queuePasswordChangedNotice(tx, user.id);
    if (onChanged) await onChanged(tx);
  });
}

export async function deleteAccount(userId: string, currentPassword: string) {
  await throttle(`reauth:${userId}`);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true, deletedAt: true },
  });
  if (
    !user?.passwordHash ||
    user.deletedAt ||
    !(await verify(user.passwordHash, currentPassword).catch(() => false))
  )
    throw new AppError('Current password is incorrect', 403);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, sessionVersion: true, deletedAt: true },
    });
    if (
      !current ||
      current.deletedAt ||
      current.passwordHash !== user.passwordHash ||
      current.sessionVersion !== user.sessionVersion
    )
      throw new AppError('Your account changed. Sign in and try again.', 409);
    await deleteAccountLocked(tx, userId);
  });
}

/** Caller holds the user row lock and has verified recent account authority. */
export async function deleteAccountLocked(tx: Prisma.TransactionClient, userId: string) {
  // Serialize ownership and membership checks with workspace deletion and team changes.
  await tx.$queryRaw`SELECT o.id FROM "Organization" o WHERE o."workspaceOwnerId" = ${userId} OR EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = o.id AND m."userId" = ${userId}) ORDER BY o.id FOR UPDATE`;
  const owned = await tx.organization.findMany({
    where: { OR: [{ workspaceOwnerId: userId }, { members: { some: { userId, role: 'OWNER' } } }] },
    select: { id: true, workspaceOwnerId: true, members: { select: { userId: true, role: true } } },
  });
  if (
    owned.some(
      (org) =>
        org.workspaceOwnerId !== userId ||
        org.members.filter((member) => member.role === 'OWNER').length !== 1 ||
        !org.members.some((member) => member.userId === userId && member.role === 'OWNER'),
    )
  )
    throw new AppError('Workspace ownership must be reconciled before account removal.', 409);
  if (owned.some((org) => org.members.length > 1))
    throw new AppError('Transfer or remove shared workspaces before removing your account.', 409);
  const running = await tx.syncJob.count({
    where: {
      account: { organizationId: { in: owned.map((org) => org.id) } },
      status: { in: ['queued', 'running'] },
    },
  });
  if (running) throw new AppError('Wait for workspace jobs to finish before account removal.', 409);
  await tx.organization.deleteMany({ where: { id: { in: owned.map((org) => org.id) } } });
  await tx.user.delete({ where: { id: userId } });
}

export async function deleteOwnedWorkspace(userId: string, organizationId: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: {
        workspaceOwnerId: true,
        members: { where: { role: 'OWNER' }, select: { userId: true } },
      },
    });
    if (
      !org ||
      org.workspaceOwnerId !== userId ||
      org.members.length !== 1 ||
      org.members[0].userId !== userId
    )
      throw new AppError('Workspace ownership must be reconciled before deletion.', 403);
    const memberships = await tx.organizationMember.count({ where: { userId } });
    if (memberships <= 1)
      throw new AppError(
        'Create another workspace first, or use Remove my account to remove your final workspace.',
        409,
      );
    await tx.organization.delete({ where: { id: organizationId } });
  });
}
