import type { ReactNode } from 'react';
import { providerIdForName } from '@/integrations/catalog';
import { ProviderLogo } from './provider-logo';
export function ProviderLabel({
  name,
  children,
  size = 20,
}: {
  name: string;
  children?: ReactNode;
  size?: number;
}) {
  const provider = providerIdForName(name);
  return (
    <span className="provider-label">
      {provider && <ProviderLogo provider={provider} size={size} />}
      {children ?? name}
    </span>
  );
}
