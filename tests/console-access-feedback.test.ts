import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ error: null as unknown }));
vi.mock('@/lib/access', () => ({
  context: async () => {
    throw state.error;
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('a', props, children),
}));
vi.mock('@/components/shell', () => ({ Shell: () => null }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: () => false }));
vi.stubGlobal('React', React);
import ConsoleLayout from '../src/app/(console)/layout';
import { AppError } from '../src/lib/security';
describe('console session and workspace failures', () => {
  it('redirects only unauthenticated access to sign in', async () => {
    state.error = new AppError('Sign in required', 401);
    await expect(ConsoleLayout({ children: 'private portfolio' })).rejects.toThrow(
      'redirect:/login',
    );
  });
  it('explains a missing workspace without denying a successful sign-in or exposing private content', async () => {
    state.error = new AppError('Workspace unavailable', 403);
    const result = renderToStaticMarkup(await ConsoleLayout({ children: 'private portfolio' }));
    expect(result).toContain('Your sign-in succeeded');
    expect(result).toContain('href="/contact"');
    expect(result).not.toContain('private portfolio');
  });
  it('propagates unexpected failures rather than pretending the account is signed out', async () => {
    state.error = new Error('storage unavailable');
    await expect(ConsoleLayout({ children: 'private portfolio' })).rejects.toThrow(
      'storage unavailable',
    );
  });
});
