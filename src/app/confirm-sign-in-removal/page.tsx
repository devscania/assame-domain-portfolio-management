import { ConfirmSignInRemoval } from '@/components/confirm-sign-in-removal';
export const metadata = {
  title: 'Confirm sign-in removal',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default async function ConfirmRemovalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ConfirmSignInRemoval token={token} />;
}
