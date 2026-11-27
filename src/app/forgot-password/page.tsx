import { AuthEmailForm } from '@/components/auth-email-form';
export const metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default function ForgotPassword() {
  return <AuthEmailForm mode="forgot" />;
}
