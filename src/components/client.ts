export async function api<T = unknown>(action: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/console', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
export async function read<T>(query: string): Promise<T> {
  const response = await fetch(`/api/console?${query}`, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load portfolio');
  return result;
}
export const formatMoney = (amount: string | number | null | undefined, currency = 'USD') =>
  amount == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: Number(amount) % 1 ? 2 : 0,
      }).format(Number(amount));
export const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value))
    : 'Not recorded';
export type Listing = {
  domainId?: string;
  providerAccountId: string | null;
  id: string;
  marketplace: string;
  binPrice: string | null;
  minOffer: string | null;
  currency: string;
  status: string;
  source: string;
  verifiedAt: string | null;
  stale: boolean;
  analytics: {
    views?: number;
    leads?: number;
    shortlists?: number;
    offers?: number;
    period?: string;
    observedAt?: string;
  } | null;
  lto: { enabled?: boolean; maxPeriod?: number } | null;
};
export type Registration = {
  id: string;
  providerAccountId?: string | null;
  registrar: string;
  expiresAt: string | null;
  registeredAt: string | null;
  renewalCost: string | null;
  currency: string;
  nameservers: string[];
  autoRenew: boolean | null;
  source: string;
  verifiedAt: string | null;
};
export type DomainRow = {
  selectedRegistrationId?: string | null;
  comparison?: import('@/lib/comparison-labels').Comparison;
  id: string;
  name: string;
  tld: string;
  currency: string;
  acquisitionCost: string;
  acquiredAt: string | null;
  askingPrice: string | null;
  status: string;
  source: string;
  confidence: string;
  createdAt: string;
  updatedAt: string;
  registrations: Registration[];
  listings: Listing[];
  tags: { tag: { id: string; name: string } }[];
  conflict?: boolean;
};
export type Sale = {
  id: string;
  domainId: string;
  domain: {
    name: string;
    acquisitionCost?: string;
    expenses?: { amount: string; currency: string }[];
  };
  grossAmount: string;
  currency: string;
  status: string;
  kind: string;
  soldAt: string;
  marketplace: string;
  payments: {
    id: string;
    amount: string;
    commissionWithheld: string;
    receivedAt: string | null;
    reference: string;
  }[];
  commissions: { amount: string }[];
  installments: { sequence: number; amount: string; dueAt: string }[];
  adjustments: { amount: string; reason: string }[];
};
export type DomainDetail = DomainRow & {
  notes: { id: string; body: string; createdAt: string }[];
  expenses: { amount: string; currency: string; category: string; occurredAt: string }[];
  prices: {
    id: string;
    marketplace: string;
    previousPrice: string | null;
    price: string | null;
    currency: string;
    source: string;
    createdAt: string;
  }[];
  renewals: { id: string; amount: string; confirmedAt: string }[];
  sales: Sale[];
};
export type Account = {
  id: string;
  label: string;
  providerId: string;
  status: string;
  lastSyncAt: string | null;
  syncEveryHours: number;
};
export type Summary = {
  marketplaceCounters: {
    marketplace: string;
    listingCount: number;
    observedCount: number;
    verifiedCount: number;
    views: string | null;
    leads: string | null;
    offers: string | null;
    shortlists: string | null;
    lastObservedAt: string | null;
  }[];
  workerConnected: boolean;
  providerSales: {
    id: string;
    domainName: string;
    status: string;
    kind: string;
    amount: string;
    currency: string;
    soldAt: string | null;
    installments: number | null;
    installmentsPaid: number | null;
    observedAt: string;
    commissionAmount: string | null;
    installmentAmount: string | null;
    nextInstallmentAt: string | null;
    previousInstallmentAt: string | null;
    disbursedAt: string | null;
    recordedInvestment: string | null;
    domainId: string | null;
    hasLedgerSale: boolean;
    account: { providerId: string; label: string };
  }[];
  providerStats: { date: string; views: number; leads: number }[];
  renewalWindows: {
    days7: number;
    days30: number;
    days60: number;
    days90: number;
    overdue: number;
  };
  renewalMonths: { month: string; label: string; count: number; cost: string }[];
  marketplaces: { marketplace: string; _count: number }[];
  ageBands: { label: string; value: number }[];
  salesMarketplaces: {
    marketplace: string;
    agreements: string;
    collected: string;
    count: number;
  }[];
  total: number;
  listingValue: string;
  listedBinDomainCount: number;
  listingCount: number;
  investment: string;
  renewalForecast: string;
  collected: string;
  undatedCash: string;
  gross: string;
  commission: string;
  unpaid: string;
  realized: string;
  expenses: string;
  renewals: string;
  totalInvestment: string;
  netReturn: string;
  conflicts: number;
  missing: number;
  expiring: number;
  monthly: { month: string; collected: string; acquisition: string }[];
  growth: { month: string; total: number }[];
  tlds: { tld: string; _count: number }[];
  registrars: { registrar: string; _count: number }[];
  activity: {
    id: string;
    label: string;
    description?: string | null;
    domainId?: string | null;
    domainName?: string | null;
    createdAt: string;
  }[];
  upcoming: (Registration & { domain: { id: string; name: string } })[];
  sales: Sale[];
  accounts: Account[];
  notifications: { id: string; title: string }[];
  currency: string;
};
