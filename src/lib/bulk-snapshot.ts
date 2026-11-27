import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

// Registration writes do not have their own updatedAt field. Include the fields
// bulk changes overwrite, and their provider provenance, in the signed preview.
export const bulkRegistrationSelect = {
  id: true,
  registrar: true,
  renewalCost: true,
  nameservers: true,
  providerAccountId: true,
  source: true,
  verifiedAt: true,
} satisfies Prisma.DomainRegistrationSelect;

type Registration = Prisma.DomainRegistrationGetPayload<{ select: typeof bulkRegistrationSelect }>;
export function bulkRegistrationDigest(registrations: Registration[]) {
  const snapshot = [...registrations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      ...item,
      renewalCost: item.renewalCost?.toString() ?? null,
      verifiedAt: item.verifiedAt?.toISOString() ?? null,
    }));
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
