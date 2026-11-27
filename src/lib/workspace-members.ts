import { db } from './db';
import { AppError } from './security';

/** Remove a non-owner, or leave a shared workspace, without modifying portfolio data. */
export async function removeWorkspaceMember(
  actorId: string,
  organizationId: string,
  membershipId: string,
  mode: 'remove' | 'leave',
) {
  const target = await db.organizationMember.findFirst({
    where: { id: membershipId, organizationId },
    select: { userId: true },
  });
  if (!target) throw new AppError('Workspace member not found.', 404);
  return db.$transaction(async (tx) => {
    const [first, second] = [actorId, target.userId].sort();
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${first} OR id = ${second} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const [org, actor, member] = await Promise.all([
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { workspaceOwnerId: true },
      }),
      tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: actorId } },
      }),
      tx.organizationMember.findFirst({
        where: { id: membershipId, organizationId, userId: target.userId },
      }),
    ]);
    if (!org || !actor || !member) throw new AppError('Workspace membership changed.', 409);
    if (member.role === 'OWNER' || member.userId === org.workspaceOwnerId)
      throw new AppError(
        'The workspace owner cannot leave or be removed. Transfer ownership first.',
        409,
      );
    if (mode === 'remove') {
      if (
        actor.role !== 'OWNER' ||
        org.workspaceOwnerId !== actorId ||
        actor.userId === member.userId
      )
        throw new AppError('Only the workspace owner can remove another member.', 403);
      if ((await tx.organizationMember.count({ where: { organizationId, role: 'OWNER' } })) !== 1)
        throw new AppError('Workspace ownership must be reconciled before removing a member.', 409);
      // Keep the removed user's account usable without retaining access to this workspace.
      if ((await tx.organizationMember.count({ where: { userId: member.userId } })) === 1) {
        await tx.organization.create({
          data: {
            name: 'My Workspace',
            workspaceOwnerId: member.userId,
            members: { create: { userId: member.userId, role: 'OWNER' } },
          },
        });
      }
    } else {
      if (member.userId !== actorId)
        throw new AppError('You can only leave your own membership.', 403);
      if ((await tx.organizationMember.count({ where: { userId: actorId } })) <= 1)
        throw new AppError('Create another workspace before leaving your last workspace.', 409);
    }
    const cancelled = await tx.workspaceTransfer.updateMany({
      where: { organizationId, toUserId: member.userId, status: 'pending' },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    await tx.organizationMember.delete({ where: { id: member.id } });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: mode === 'remove' ? 'team.member_removed' : 'team.member_left',
        entityId: member.userId,
        detail: { cancelledTransfers: cancelled.count },
      },
    });
  });
}
