import { AsyncLocalStorage } from 'node:async_hooks';

type Grant = { userId: string; sessionId: string; provider: string; used: boolean };
const context = new AsyncLocalStorage<Grant>();

/** Scoped to the guarded callback request after its single-use intent is consumed. */
export function runGuardedOAuthLink<T>(grant: Omit<Grant, 'used'>, run: () => T): T {
  return context.run({ ...grant, used: false }, run);
}
export function consumeGuardedOAuthLink(userId: string, provider: string) {
  const grant = context.getStore();
  if (!grant || grant.used || grant.userId !== userId || grant.provider !== provider) return null;
  grant.used = true;
  return grant;
}
