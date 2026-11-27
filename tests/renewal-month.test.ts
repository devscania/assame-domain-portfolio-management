import { describe, expect, it } from 'vitest';
import { expirationMonthWindow, expirationWindow } from '../src/lib/expiration';
describe('UTC renewal calendar boundaries', () => {
  it('uses inclusive month start and exclusive next-month start across a year boundary', () => {
    const range = expirationWindow(new URLSearchParams('month=2026-12'));
    expect(range?.gte?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(range?.lt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('rejects malformed and out-of-range months', () => {
    for (const value of ['2027-13', '2027-0', '2027-01-15', '1969-12', '9999-12', 'not-a-month'])
      expect(expirationMonthWindow(value)).toBeUndefined();
  });
});
