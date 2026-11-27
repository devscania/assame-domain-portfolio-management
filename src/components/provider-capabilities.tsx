import { Check } from 'lucide-react';
import { providers, type Capability, type ProviderId } from '@/integrations/catalog';

const capabilities: [Capability, string][] = [
  ['readInventory', 'Inventory'],
  ['readListings', 'Listings'],
  ['readPrices', 'Prices'],
  ['updatePrices', 'Update prices'],
  ['addListings', 'Add listings'],
  ['removeListings', 'Remove listings'],
  ['readSales', 'Sales'],
  ['readAnalytics', 'Analytics'],
  ['readExpiration', 'Expirations'],
  ['manageNameservers', 'Manage nameservers'],
  ['manageRenewals', 'Renew domains'],
];

export function ProviderCapabilities({ provider }: { provider: ProviderId }) {
  const supported = providers[provider].capabilities;
  return (
    <ul className="capability-list" role="list" aria-label="Supported capabilities">
      {capabilities.map(
        ([key, label]) =>
          supported[key] && (
            <li key={key}>
              <Check size={13} aria-hidden="true" />
              {label}
            </li>
          ),
      )}
      {provider === 'atom' && <li>CSV fallback available</li>}
    </ul>
  );
}
