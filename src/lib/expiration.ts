/** Calendar-month boundaries are UTC and exclude the first instant of the next month. */
export function expirationMonthWindow(value: string | null) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return undefined;
  const [year, month] = value.split('-').map(Number);
  if (year < 1970 || year > 9998) return undefined;
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
}
export function expirationWindow(
  query: URLSearchParams,
  now = new Date(),
): { lt?: Date; gte?: Date; lte?: Date } | undefined {
  const month = expirationMonthWindow(query.get('month'));
  if (month) return month;
  const mode = query.get('expiration');
  const days = Number(query.get('days'));
  if (mode === 'expired') return { lt: now };
  if (mode === 'upcoming') return { gte: now };
  if (days > 0) return { gte: now, lte: new Date(now.getTime() + Math.min(days, 365) * 86400000) };
  return undefined;
}
