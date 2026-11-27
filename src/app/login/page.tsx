import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { brand } from '@/lib/brand';
import { oauthProviders, providerEnabled } from '@/lib/oauth-policy';
export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user?.id) redirect('/overview');
  const clearStaleSession = (await cookies())
    .getAll()
    .some(({ name }) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(name));
  return (
    <LoginForm
      demo={process.env.DEMO_MODE === 'true'}
      brand={brand.name}
      providers={oauthProviders.filter(providerEnabled)}
      oauthError={Boolean(params.error)}
      clearStaleSession={clearStaleSession}
    />
  );
}
