import { OAuthSignupHandoff } from '@/components/oauth-signup-handoff';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Finishing sign-in',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default function OAuthCompletePage() {
  return <OAuthSignupHandoff next="/overview" />;
}
