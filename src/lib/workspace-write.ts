import type { Prisma } from '@prisma/client';
import type { Context } from './access';
import { lockWorkspaceOwner } from './workspace-owner';
import { requireRole } from './permissions';
import { AppError } from './security';

export type CustomWorkspacePermission = 'domainDeletion' | 'financeRecords' | 'sync';

/** Serialize workspace writes with ownership changes and current membership. */
export async function lockWorkspaceMembership(
  tx: Prisma.TransactionClient,
  ctx: Context,
  minimum: 'EDITOR' | 'ADMIN' | 'OWNER' = 'EDITOR',
  permission?: CustomWorkspacePermission,
) {
  return lockWorkspaceMembershipForActor(tx, ctx.org.id, ctx.user.id!, minimum, false, permission);
}

export async function lockWorkspaceMembershipForActor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  minimum: 'EDITOR' | 'ADMIN' | 'OWNER' = 'EDITOR',
  providerWrite = false,
  permission?: CustomWorkspacePermission,
) {
  const reference = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { workspaceOwnerId: true },
  });
  if (!reference) throw new AppError('Workspace access changed. Refresh and try again.', 403);
  if (reference.workspaceOwnerId) await lockWorkspaceOwner(tx, organizationId);
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  const current = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { workspaceOwnerId: true },
  });
  // If ownership appeared meanwhile, retry in the owner-first lock order.
  if (!current || current.workspaceOwnerId !== reference.workspaceOwnerId)
    throw new AppError('Workspace ownership changed; retry the operation', 409);
  if (!current.workspaceOwnerId && providerWrite)
    throw new AppError('Workspace ownership must be resolved before provider publishing', 409);
  const member = await tx.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: actorId } },
    select: {
      role: true,
      customRoleId: true,
      customRole: true,
    },
  });
  if (!member) throw new AppError('Workspace access changed. Refresh and try again.', 403);
  if (
    member.customRoleId &&
    (!current.workspaceOwnerId ||
      !member.customRole ||
      member.customRole.organizationId !== organizationId ||
      member.customRole.baseRole !== member.role)
  )
    throw new AppError('This custom workspace role is unavailable.', 403);
  requireRole(member, minimum);
  if (providerWrite && member.customRoleId && !member.customRole?.allowProviderWrites)
    throw new AppError('Your custom workspace role does not allow provider publishing.', 403);
  if (member.customRoleId && permission) {
    const allowed = {
      domainDeletion: member.customRole?.allowDomainDeletion,
      financeRecords: member.customRole?.allowFinanceRecords,
      sync: member.customRole?.allowSync,
    }[permission];
    if (!allowed) throw new AppError('Your custom workspace role does not allow this action.', 403);
  }
}
export async function lockWritableWorkspace(
  tx: Prisma.TransactionClient,
  ctx: Context,
  minimum: 'EDITOR' | 'ADMIN' | 'OWNER' = 'EDITOR',
  providerWrite = false,
  permission?: CustomWorkspacePermission,
) {
  return lockWritableWorkspaceForActor(
    tx,
    ctx.org.id,
    ctx.user.id!,
    minimum,
    providerWrite,
    permission,
  );
}

/** Keep ownership and membership locks through the mutation authorization point. */
export async function lockWritableWorkspaceForActor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  minimum: 'EDITOR' | 'ADMIN' | 'OWNER' = 'EDITOR',
  providerWrite = false,
  permission?: CustomWorkspacePermission,
) {
  await lockWorkspaceOwner(tx, organizationId);
  await lockWorkspaceMembershipForActor(
    tx,
    organizationId,
    actorId,
    minimum,
    providerWrite,
    permission,
  );
}
