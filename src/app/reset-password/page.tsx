import { AuthEmailForm } from '@/components/auth-email-form';
export const metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AuthEmailForm mode="reset" token={token} />;
}
