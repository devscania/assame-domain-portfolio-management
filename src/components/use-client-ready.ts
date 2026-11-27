'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Keep JavaScript-only authentication controls inert until hydration attaches
 * their handlers. The server and first hydration snapshot agree without storage.
 */
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
