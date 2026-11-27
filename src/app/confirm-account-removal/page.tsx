import { ConfirmAccountRemoval } from '@/components/confirm-account-removal';
export const metadata = {
  title: 'Confirm account removal',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default async function ConfirmAccountRemovalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <ConfirmAccountRemoval token={(await searchParams).token} />;
}
