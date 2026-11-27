import { AuthEmailForm } from '@/components/auth-email-form';
export const metadata = {
  title: 'Verify email',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default async function VerifyEmail({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AuthEmailForm mode="verify" token={token} />;
}
