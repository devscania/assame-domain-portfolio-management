import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  lookup: vi.fn(),
  authCalls: 0,
}));
vi.mock('@/auth', () => ({
  auth: (handler: (request: unknown, event: unknown) => unknown) =>
    (request: NextRequest, event: NextFetchEvent) => {
      state.authCalls++;
      return handler(Object.assign(request, { auth: state.session }), event);
    },
}));
vi.mock('@/lib/db', () => ({ db: { userPreference: { findUnique: state.lookup } } }));
import { proxy } from '../src/proxy';

const event = {} as NextFetchEvent;
function request(cookie?: string) {
  return new NextRequest('https://portfolio.example.test/about', { headers: cookie ? { cookie } : {} });
}

describe('public account theme hint', () => {
  beforeEach(() => {
    state.session = null;
    state.authCalls = 0;
    state.lookup.mockReset();
  });
  it('leaves anonymous pages cacheable without authentication or database access', async () => {
    const response = await proxy(request(), event);
    expect(state.authCalls).toBe(0);
    expect(state.lookup).not.toHaveBeenCalled();
    expect(response?.headers.get('cache-control')).toBeNull();
  });
  it('uses the validated session account theme on private responses', async () => {
    state.session = { user: { id: 'user-a' } };
    state.lookup.mockResolvedValue({ theme: 'dark' });
    const response = await proxy(request('authjs.session-token=fixture'), event);
    expect(state.lookup).toHaveBeenCalledWith({ where: { userId: 'user-a' }, select: { theme: true } });
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    expect(response?.headers.get('set-cookie')).toContain('assame-account-theme=dark');
  });
  it('clears stale hints after logout or session revocation', async () => {
    const anonymous = await proxy(request('assame-account-theme=dark'), event);
    expect(state.authCalls).toBe(0);
    expect(anonymous?.headers.get('set-cookie')).toContain('Max-Age=0');
    const revoked = await proxy(request('authjs.session-token=revoked; assame-account-theme=dark'), event);
    expect(revoked?.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(revoked?.headers.get('cache-control')).toBe('private, no-store');
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it('falls back to local appearance without exposing a stale hint on storage errors', async () => {
    state.session = { user: { id: 'user-a' } };
    state.lookup.mockRejectedValue(new Error('database unavailable'));
    const response = await proxy(request('authjs.session-token=fixture; assame-account-theme=dark'), event);
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
  });
});
