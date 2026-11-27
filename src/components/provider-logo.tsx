import { FileSpreadsheet, Globe2 } from 'lucide-react';
import { providers, type ProviderId } from '@/integrations/catalog';

export function ProviderLogo({
  provider,
  size = 40,
  decorative = true,
}: {
  provider: ProviderId | 'csv';
  size?: number;
  decorative?: boolean;
}) {
  const isCsv = provider === 'csv';
  const Icon = isCsv ? FileSpreadsheet : Globe2;
  return (
    <span
      aria-hidden={decorative || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: Math.round(size / 5),
        background: '#fff',
        border: '1px solid #e2e8e4',
      }}
    >
      <Icon
        size={Math.round(size * 0.62)}
        color={isCsv ? '#087a32' : providers[provider].color}
        aria-label={decorative ? undefined : isCsv ? 'CSV file import' : providers[provider].name}
      />
    </span>
  );
}
