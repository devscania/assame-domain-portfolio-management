export type Capability =
  | 'readInventory'
  | 'readListings'
  | 'readPrices'
  | 'updatePrices'
  | 'addListings'
  | 'removeListings'
  | 'readSales'
  | 'readAnalytics'
  | 'readExpiration'
  | 'manageNameservers'
  | 'manageRenewals';
const no = {
  readInventory: false,
  readListings: false,
  readPrices: false,
  updatePrices: false,
  addListings: false,
  removeListings: false,
  readSales: false,
  readAnalytics: false,
  readExpiration: false,
  manageNameservers: false,
  manageRenewals: false,
};
export const providers = {
  godaddy: {
    name: 'GoDaddy',
    kind: 'registrar',
    color: '#00a4a6',
    description: 'Registered and expiring domain inventory, dates, auto-renew and nameservers.',
    permissions: 'Personal Access Token with domains.domain:read. Management API eligibility is required. No DNS, purchase, renewal or marketplace writes are implemented.',
    docs: 'https://developer.godaddy.com/en/docs/api-users/domains/manage/list',
    capabilities: { ...no, readInventory: true, readExpiration: true },
    available: true,
  },
  afternic: {
    name: 'Afternic',
    kind: 'marketplace',
    color: '#f59e0b',
    description: 'Marketplace listings, prices, sales and traffic where available.',
    permissions:
      'Portfolio API key and secret. Synchronization uses reads; confirmed BIN changes use PATCH and confirmed listing creation uses POST.',
    docs: 'https://api.afternic.com/docs/portfolio-api/',
    capabilities: {
      ...no,
      readListings: true,
      readPrices: true,
      readAnalytics: true,
      readSales: true,
      updatePrices: true,
      addListings: true,
      removeListings: true,
    },
    available: true,
  },
  spaceship: {
    name: 'Spaceship',
    kind: 'registrar + marketplace',
    color: '#7856ff',
    description: 'Registrar inventory and SellerHub listings, together.',
    permissions:
      'domains:read and sellerhub:read for synchronization. sellerhub:write enables confirmed listing changes. domains:write enables confirmed custom nameserver changes. Billing and transfer permissions are unnecessary.',
    docs: 'https://docs.spaceship.dev/',
    capabilities: {
      ...no,
      readInventory: true,
      readListings: true,
      readPrices: true,
      readExpiration: true,
      readSales: true,
      updatePrices: true,
      addListings: true,
      removeListings: true,
      manageNameservers: true,
    },
    available: true,
  },
  dynadot: {
    name: 'Dynadot',
    kind: 'both',
    color: '#1676ce',
    description: 'Registrar inventory and Dynadot marketplace listings, together.',
    permissions:
      'Account API key and optional RESTful v2 Secret Key (for X-Signature signing); allowlist your worker’s outbound IP in Dynadot Tools → API. Sync imports registrar inventory and active Dynadot marketplace listings.',
    docs: 'https://www.dynadot.com/domain/api',
    capabilities: {
      ...no,
      readInventory: true,
      readExpiration: true,
      readListings: true,
      readPrices: true,
      updatePrices: true,
      addListings: true,
      removeListings: true,
    },
    available: true,
  },
  namecheap: {
    name: 'Namecheap',
    kind: 'registrar',
    color: '#de581c',
    description: 'Registrar inventory, expiration dates, and auto-renew status.',
    permissions:
      'Enable API access in Profile → Tools → Namecheap API Access and allowlist your deployment’s outbound IPv4 address. Supports inventory synchronization.',
    docs: 'https://www.namecheap.com/support/api/methods/domains/get-list/',
    capabilities: { ...no, readInventory: true, readExpiration: true, manageNameservers: true },
    available: true,
  },
  sedo: {
    name: 'Sedo',
    kind: 'marketplace',
    color: '#27569d',
    description: 'Marketplace listing status, Buy Now prices and minimum offers.',
    permissions: 'Sedo Basic API access, Partner ID, sign key, and the Sedo account username and password.',
    docs: 'https://api.sedo.com/apidocs/v1/Basic/',
    capabilities: {
      ...no,
      readListings: true,
      readPrices: true,
      updatePrices: true,
      addListings: true,
      removeListings: true,
    },
    available: false,
  },
  atom: {
    name: 'Atom',
    kind: 'marketplace',
    color: '#ed6c42',
    description: 'Brandable domains and premium marketplace listings.',
    permissions:
      'Seller API token and its seller user ID. seller.read for sync/statistics; seller.write for confirmed BIN changes and Standard listing creation and removal. Premium submissions that spend a coin are excluded.',
    docs: 'https://apidocs.atom.com/api-reference/seller_apis/domains',
    capabilities: {
      ...no,
      readListings: true,
      readPrices: true,
      readAnalytics: true,
      updatePrices: true,
      addListings: true,
      removeListings: true,
    },
    available: true,
  },
  atomRegistrar: {
    name: 'Atom Registrar',
    kind: 'registrar',
    color: '#ed6c42',
    description: 'Registered domains, expiration dates and auto-renew observations.',
    permissions:
      'A Registrar API bearer token with registrar read access. A seller.read/seller.write token alone is insufficient. DNS editing is not available in Assame.',
    docs: 'https://apidocs.atom.com/guides/registrar_apis',
    capabilities: { ...no, readInventory: true, readExpiration: true },
    available: true,
  },
} as const;
export type ProviderId = keyof typeof providers;
export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providers, value);
}
export function isAvailableProvider(value: string): value is ProviderId {
  return isProviderId(value) && providers[value].available;
}
export const availableProviderIds = Object.keys(providers).filter(isAvailableProvider);

/** Exact normalized aliases only: unknown registrars keep their own fallback. */
export function providerIdForName(value: string | null | undefined): ProviderId | undefined {
  if (!value) return undefined;
  if (isProviderId(value)) return value;
  const aliases: Record<string, ProviderId> = {
    godaddy: 'godaddy', godaddycom: 'godaddy', godaddycomllc: 'godaddy',
    afternic: 'afternic', afterniccom: 'afternic',
    spaceship: 'spaceship', spaceshipinc: 'spaceship', sellerhub: 'spaceship',
    dynadot: 'dynadot', dynadotllc: 'dynadot',
    namecheap: 'namecheap', namecheapinc: 'namecheap',
    sedo: 'sedo', sedocom: 'sedo', sedogmbh: 'sedo',
    atom: 'atom', atomcom: 'atom', atomregistrar: 'atomRegistrar', atomregistrarinc: 'atomRegistrar',
  };
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined;
}
export function assertCapability(provider: ProviderId, capability: Capability) {
  if (!providers[provider].capabilities[capability])
    throw new Error(`${providers[provider].name}: ${capability} is unsupported in this release`);
}
