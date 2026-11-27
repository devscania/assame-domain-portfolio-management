import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { db } from './db';
import { AppError } from './security';
export async function context() {
  const session = await auth();
  if (!session?.user?.id) throw new AppError('Sign in required', 401);
  const selected = (await cookies()).get('workspace')?.value;
  const members = await db.organizationMember.findMany({
    where: { userId: session.user.id },
    include: { organization: true },
  });
  const member = members.find((m) => m.organizationId === selected) ?? members[0];
  if (!member) throw new AppError('Workspace unavailable', 403);
  let effectiveRole = member.role;
  if (member.customRoleId) {
    const policy = await db.organizationMember.findUnique({
      where: { id: member.id },
      select: {
        role: true,
        customRole: true,
      },
    });
    if (
      !member.organization.workspaceOwnerId ||
      !policy?.customRole ||
      policy.customRole.organizationId !== member.organizationId ||
      policy.customRole.baseRole !== policy.role
    )
      effectiveRole = 'VIEWER';
  }
  return { user: session.user, org: member.organization, role: effectiveRole, members };
}
export type Context = Awaited<ReturnType<typeof context>>;
export { requireRole } from './permissions';
