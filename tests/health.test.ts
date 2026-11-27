import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/lib/db', () => ({ db: { $queryRaw: fixture.query } }));
import { GET } from '../src/app/api/health/route';

afterEach(() => fixture.query.mockReset());
describe('health endpoint', () => {
  it('returns uncached success after a database check', async () => {
    fixture.query.mockResolvedValue([{ '?column?': 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });
  it('reports an unavailable database without revealing error details', async () => {
    fixture.query.mockRejectedValue(new Error('synthetic database secret'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('synthetic database secret');
  });
});
