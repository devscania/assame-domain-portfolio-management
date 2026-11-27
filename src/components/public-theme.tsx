'use client';
import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAppearance } from './appearance';
const subscribe = () => () => {};
const choices = ['system', 'light', 'dark'] as const;
export function PublicTheme() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const { theme } = useTheme();
  const { changeTheme } = useAppearance();
  const current = mounted && (theme === 'light' || theme === 'dark') ? theme : 'system';
  const next = choices[(choices.indexOf(current) + 1) % choices.length];
  const Icon = current === 'system' ? Monitor : current === 'light' ? Sun : Moon;
  const label = `Theme: ${current}. Switch to ${next} theme`;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      data-theme-choice={current}
      disabled={!mounted}
      onClick={() => changeTheme(next)}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
