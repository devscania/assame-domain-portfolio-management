import type { Role } from '@prisma/client';
import { AppError } from './security';
export function requireRole(ctx: { role: Role }, minimum: 'EDITOR' | 'ADMIN' | 'OWNER' = 'EDITOR') {
  const rank: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
  if (rank[ctx.role] < rank[minimum])
    throw new AppError('Your workspace role does not allow this action', 403);
}
