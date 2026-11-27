export const comparisonLabels = {
  mismatch: 'Price mismatch',
  currency: 'Different currencies',
  stale: 'Stale listings',
  unpriced: 'Missing BIN prices',
  insufficient: 'Insufficient listings',
  match: 'Prices match',
} as const;
export type Comparison = keyof typeof comparisonLabels;
