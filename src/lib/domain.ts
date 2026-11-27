import { domainToASCII, domainToUnicode } from 'node:url';
import Decimal from 'decimal.js';
import { z } from 'zod';
export function normalizeDomain(input: string) {
  const raw = input.trim().toLowerCase().replace(/\.$/, '');
  if (/[\s/\\:@?#%]/.test(raw)) throw new Error('Enter a domain name without a URL, path, or port');
  const name = domainToASCII(raw);
  if (
    !name ||
    name.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(name) ||
    /^\d+(\.\d+){3}$/.test(name)
  )
    throw new Error('Enter a domain name without a URL, path, or port');
  return { name, unicodeName: domainToUnicode(name), tld: name.split('.').slice(1).join('.') };
}
export const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a positive amount with at most 2 decimal places');
export const currency = z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
export const domainInput = z.object({
  name: z.string().min(3).max(253),
  acquisitionCost: money.default('0'),
  askingPrice: money.optional(),
  currency: currency.default('USD'),
  registrar: z.string().max(100).default('Unknown'),
  expiresAt: z.string().date().optional(),
  acquiredAt: z.string().date().optional(),
  renewalCost: money.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type DomainInput = z.infer<typeof domainInput>;
export function installments(total: string, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 120)
    throw new Error('Invalid installment count');
  const cents = new Decimal(total).times(100);
  if (!cents.isInteger() || cents.lt(count))
    throw new Error('Amount too small for installment count');
  const base = cents.div(count).floor();
  return Array.from({ length: count }, (_, i) =>
    base
      .plus(i < cents.minus(base.times(count)).toNumber() ? 1 : 0)
      .div(100)
      .toFixed(2),
  );
}
export function sum(values: (string | { toString(): string })[]) {
  return values.reduce<Decimal>((a, b) => a.plus(b.toString()), new Decimal(0)).toFixed(2);
}
export function installmentDueDate(start: string, offset: number) {
  const base = new Date(`${start.slice(0, 10)}T00:00:00.000Z`);
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + offset);
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, last));
  return base;
}
export function conflict(prices: { binPrice: { toString(): string } | null; currency: string }[]) {
  return (
    new Set(
      prices
        .filter((p) => p.binPrice !== null && new Decimal(p.binPrice.toString()).gt(0))
        .map((p) => `${p.currency}:${new Decimal(p.binPrice!.toString()).toFixed(2)}`),
    ).size > 1
  );
}
export { financials } from './finance';
