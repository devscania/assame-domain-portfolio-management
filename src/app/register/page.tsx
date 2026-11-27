import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { brand } from '@/lib/brand';
import { oauthProviders, providerEnabled } from '@/lib/oauth-policy';
export const metadata = { title: 'Create an account', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function RegisterPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/overview');
  const clearStaleSession = (await cookies())
    .getAll()
    .some(({ name }) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(name));
  return (
    <LoginForm
      demo={false}
      brand={brand.name}
      clearStaleSession={clearStaleSession}
      initialRegister
      providers={oauthProviders.filter(providerEnabled)}
    />
  );
}
