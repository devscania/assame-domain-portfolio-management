import { expect, it, vi } from 'vitest';
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../src/lib/db', () => ({ db: { syncJob: { findMany } } }));
import { providerJobsForDispatch } from '../src/lib/provider-priority';

it('dispatches a bounded oldest-first page of queued jobs at equal priority', async () => {
  findMany.mockResolvedValue([{ id: 'oldest' }, { id: 'newest' }]);
  expect(await providerJobsForDispatch()).toEqual([
    { id: 'oldest', priority: 0 },
    { id: 'newest', priority: 0 },
  ]);
  expect(findMany).toHaveBeenCalledWith({
    where: { status: 'queued' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true },
  });
});
