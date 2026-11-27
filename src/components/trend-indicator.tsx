import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { TrendChange } from '@/lib/financial-trends';

export function TrendIndicator({ change, label }: { change: TrendChange; label?: string }) {
  const Icon =
    change.direction === 'up' ? ArrowUpRight : change.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`financial-trend-indicator trend-${change.direction}`}>
      <Icon size={14} aria-hidden="true" />
      <span>
        {change.label}
        {label && <small>{label}</small>}
      </span>
    </span>
  );
}
