import { db } from './db';
import { AppError } from './security';

export async function requestWorkspaceTransfer(
  actorId: string,
  organizationId: string,
  email: string,
  confirmation: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      include: { members: { include: { user: { select: { email: true } } } } },
    });
    const owners = org?.members.filter((member) => member.role === 'OWNER') ?? [];
    if (
      !org ||
      org.workspaceOwnerId !== actorId ||
      owners.length !== 1 ||
      owners[0].userId !== actorId
    )
      throw new AppError('Workspace ownership must be verified before transfer.', 403);
    if (confirmation !== org.name) throw new AppError('Enter the exact workspace name to confirm.');
    const recipient = org.members.find(
      (member) => member.user.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!recipient || recipient.userId === actorId)
      throw new AppError('Choose another existing member of this workspace.');
    await tx.workspaceTransfer.updateMany({
      where: { organizationId, status: 'pending', expiresAt: { lte: new Date() } },
      data: { status: 'expired', resolvedAt: new Date() },
    });
    const existing = await tx.workspaceTransfer.findFirst({
      where: { organizationId, status: 'pending' },
    });
    if (existing) throw new AppError('This workspace already has a pending transfer.', 409);
    const transfer = await tx.workspaceTransfer.create({
      data: {
        organizationId,
        fromUserId: actorId,
        toUserId: recipient.userId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'workspace.transfer.requested',
        entityId: transfer.id,
        detail: { recipientId: recipient.userId },
      },
    });
    return transfer;
  });
}

export async function resolveWorkspaceTransfer(
  actorId: string,
  transferId: string,
  action: 'accept' | 'decline' | 'cancel',
) {
  return db.$transaction(async (tx) => {
    const initial = await tx.workspaceTransfer.findUnique({ where: { id: transferId } });
    if (
      !initial ||
      (action === 'cancel' ? initial.fromUserId !== actorId : initial.toUserId !== actorId)
    )
      throw new AppError('Transfer not found.', 404);
    const [first, second] = [initial.fromUserId, initial.toUserId].sort();
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${first} OR id = ${second} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${initial.organizationId} FOR UPDATE`;
    const transfer = await tx.workspaceTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.status !== 'pending' || transfer.expiresAt <= new Date())
      throw new AppError('This transfer is no longer pending.', 409);
    if (action === 'accept') {
      const org = await tx.organization.findUnique({
        where: { id: transfer.organizationId },
        include: { members: true },
      });
      const owners = org?.members.filter((member) => member.role === 'OWNER') ?? [];
      if (
        !org ||
        org.workspaceOwnerId !== transfer.fromUserId ||
        owners.length !== 1 ||
        owners[0].userId !== transfer.fromUserId ||
        !org.members.some((member) => member.userId === actorId)
      )
        throw new AppError(
          'Workspace ownership or membership changed. Request a new transfer.',
          409,
        );
      const running = await tx.syncJob.count({
        where: { account: { organizationId: org.id }, status: { in: ['queued', 'running'] } },
      });
      if (running)
        throw new AppError('Wait for workspace jobs to finish before accepting ownership.', 409);
      await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId: org.id, userId: transfer.fromUserId } },
        data: { role: 'ADMIN', customRoleId: null },
      });
      await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId: org.id, userId: actorId } },
        data: { role: 'OWNER', customRoleId: null },
      });
      await tx.organization.update({ where: { id: org.id }, data: { workspaceOwnerId: actorId } });
    }
    const status =
      action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
    await tx.workspaceTransfer.update({
      where: { id: transferId },
      data: { status, resolvedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        organizationId: transfer.organizationId,
        actorId,
        action: `workspace.transfer.${status}`,
        entityId: transferId,
        detail: { fromUserId: transfer.fromUserId, toUserId: transfer.toUserId },
      },
    });
  });
}
