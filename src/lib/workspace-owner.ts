import type { Prisma } from '@prisma/client';
import { AppError } from './security';

export const activeDomain = {
  deletedAt: null,
  status: { not: 'archived' },
  sales: { none: { status: 'completed' } },
} satisfies Prisma.DomainWhereInput;

/** Keep workspace ownership stable for the duration of a transaction. */
export async function lockWorkspaceOwner(tx: Prisma.TransactionClient, organizationId: string) {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { workspaceOwnerId: true },
  });
  if (!org?.workspaceOwnerId)
    throw new AppError('Workspace ownership must be resolved before changing domains', 409);
  const ownerId = org.workspaceOwnerId;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
  const current = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { workspaceOwnerId: true },
  });
  if (current?.workspaceOwnerId !== ownerId)
    throw new AppError('Workspace ownership changed; retry the operation', 409);
}
