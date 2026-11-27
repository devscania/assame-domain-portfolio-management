import { db } from './db';

export async function providerJobsForDispatch() {
  const jobs = await db.syncJob.findMany({
    where: { status: 'queued' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true },
  });
  return jobs.map(({ id }) => ({ id, priority: 0 }));
}
