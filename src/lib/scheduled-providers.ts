import { availableProviderIds } from '@/integrations/catalog';
import { db } from '@/lib/db';

const pageSize = 1000;

/** A stable keyset scan avoids starving accounts beyond the first page. */
export async function scheduledProviderPage(after?: string) {
  const accounts = await db.providerAccount.findMany({
    where: {
      ...(after ? { id: { gt: after } } : {}),
      providerId: { in: availableProviderIds },
      status: { in: ['connected', 'error'] },
      credential: { isNot: null },
      syncEveryHours: { gt: 0 },
      organization: { demo: false },
    },
    orderBy: { id: 'asc' },
    take: pageSize,
  });
  return {
    accounts,
    next: accounts.length === pageSize ? accounts[accounts.length - 1].id : undefined,
  };
}
