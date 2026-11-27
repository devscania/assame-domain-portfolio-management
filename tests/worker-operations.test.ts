import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ find: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock('../src/lib/db', () => ({ db: { providerAccount: { findMany: fixture.find }, $queryRaw: fixture.query, $executeRaw: fixture.execute } }));
import { scheduledProviderPage } from '../src/lib/scheduled-providers';
import { recordWorkerDispatch, workerDispatchHealth } from '../src/lib/worker-health';

describe('worker operations', () => {
  it('scans all scheduled accounts in ordered bounded pages and then restarts', async () => {
    const ids = Array.from({ length: 2001 }, (_, i) => `account-${String(i).padStart(4, '0')}`);
    fixture.find.mockImplementation(async ({ where, take, orderBy }) => {
      expect(orderBy).toEqual({ id: 'asc' });
      expect(take).toBe(1000);
      expect(where.providerId.in).toContain('atom');
      expect(where.providerId.in).not.toContain('sedo');
      return ids.filter((id) => !where.id || id > where.id.gt).slice(0, take).map((id) => ({ id }));
    });
    const first = await scheduledProviderPage();
    const second = await scheduledProviderPage(first.next);
    const third = await scheduledProviderPage(second.next);
    expect([...first.accounts, ...second.accounts, ...third.accounts].map(({ id }) => id)).toEqual(ids);
    expect(third.next).toBeUndefined();
  });
  it('reports a missing or stale dispatch without claiming worker delivery health', async () => {
    fixture.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ lastCompletedAt: new Date('2026-01-01'), recent: false }]);
    expect(await workerDispatchHealth()).toEqual({ lastCompletedAt: null, recent: false });
    expect((await workerDispatchHealth()).recent).toBe(false);
    await recordWorkerDispatch();
    expect(fixture.execute).toHaveBeenCalledOnce();
  });
});
