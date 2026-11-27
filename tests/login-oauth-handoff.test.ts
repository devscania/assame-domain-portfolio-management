import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  intent: vi.fn(),
  error: vi.fn(),
  setState: vi.fn(),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (value: unknown) => [value, mocks.setState],
}));
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn, signOut: mocks.signOut }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/components/analytics', () => ({
  beginOAuthSignupIntent: mocks.intent,
  trackPublicEvent: vi.fn(),
}));
vi.mock('@/components/use-client-ready', () => ({ useClientReady: () => true }));
vi.mock('@/components/public-theme', () => ({ PublicTheme: () => null }));
vi.mock('@/components/ui', () => ({ Button: () => null, Field: () => null, Input: () => null }));
vi.mock('next/link', () => ({ default: () => null }));
vi.stubGlobal('React', React);
import { LoginForm } from '../src/components/login-form';
function oauthAction(clearStaleSession: boolean) {
  const tree = LoginForm({
    demo: false,
    brand: 'Fixture',
    providers: ['google'],
    clearStaleSession,
  });
  function find(node: React.ReactNode): null | (() => Promise<void>) {
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    }
    if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => Promise<void> }>(node))
      return null;
    if (node.key === 'google') return node.props.onClick!;
    return find(node.props.children);
  }
  return find(tree)!;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.intent.mockReturnValue(false);
  mocks.signIn.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
});
describe('fresh OAuth handoff from a stale session', () => {
  it('waits for canonical sign-out before consent intent and provider sign-in', async () => {
    let release!: () => void;
    mocks.signOut.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const pending = oauthAction(true)();
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(mocks.intent).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    release();
    await pending;
    expect(mocks.intent).toHaveBeenCalledWith('google', false);
    expect(mocks.signIn).toHaveBeenCalledWith('google', { callbackUrl: '/overview' });
  });
  it('does not start a provider callback when clearing stale identity fails', async () => {
    mocks.signOut.mockRejectedValue(new Error('offline'));
    await oauthAction(true)();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.intent).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.setState).toHaveBeenLastCalledWith(false);
  });
  it('starts ordinary anonymous OAuth without an unnecessary sign-out', async () => {
    await oauthAction(false)();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalled();
  });
});
