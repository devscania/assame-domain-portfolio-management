import React from 'react';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  names: [] as string[],
}));
vi.mock('@/auth', () => ({ auth: async () => state.session }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => state.names.map((name) => ({ name, value: 'synthetic' })),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock('@/components/login-form', () => ({ LoginForm: () => null }));
vi.stubGlobal('React', React);
import LoginPage from '../src/app/login/page';
import RegisterPage from '../src/app/register/page';
describe('sign-in session handoff', () => {
  it('resumes a verified session at the portfolio overview', async () => {
    state.session = { user: { id: 'account' } };
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/overview',
    );
  });
  it('flags only real stale Auth.js session cookie names when server authentication is absent', async () => {
    state.session = null;
    for (const name of [
      'authjs.session-token',
      'authjs.session-token.0',
      '__Secure-authjs.session-token',
      '__Secure-authjs.session-token.1',
    ]) {
      state.names = [name];
      expect((await LoginPage({ searchParams: Promise.resolve({}) })).props.clearStaleSession).toBe(
        true,
      );
    }
    for (const name of ['unrelated', 'authjs.session-token.attacker-suffix']) {
      state.names = [name];
      expect((await LoginPage({ searchParams: Promise.resolve({}) })).props.clearStaleSession).toBe(
        false,
      );
    }
  });
});

describe('registration session handoff', () => {
  it('resumes a valid account rather than starting another registration or OAuth link', async () => {
    state.session = { user: { id: 'account' } };
    await expect(RegisterPage()).rejects.toThrow('redirect:/overview');
  });
  it('passes strict stale-session recovery to OAuth while preserving registration mode', async () => {
    state.session = null;
    for (const name of ['authjs.session-token', '__Secure-authjs.session-token.0']) {
      state.names = [name];
      const page = await RegisterPage();
      expect(page.props.clearStaleSession).toBe(true);
      expect(page.props.initialRegister).toBe(true);
    }
  });
  it('does not request sign-out for anonymous visitors or unrelated cookie names', async () => {
    state.session = null;
    for (const names of [[], ['unrelated'], ['authjs.session-token.attacker-suffix']]) {
      state.names = names;
      expect((await RegisterPage()).props.clearStaleSession).toBe(false);
    }
  });
});
