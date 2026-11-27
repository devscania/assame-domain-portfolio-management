import Link from 'next/link';
import { ArrowUpRight, KeyRound, UserRound, ShieldCheck } from 'lucide-react';
import { context } from '@/lib/access';
import { db } from '@/lib/db';
import { ProviderIcon } from '@/components/provider-icon';
import { ProfileNameForm } from '@/components/profile-name-form';

export default async function ProfilePanel() {
  const { user } = await context();
  const account = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      createdAt: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });
  const providers = [
    ...new Set(
      account.accounts
        .map((item) => item.provider)
        .filter((item) => item === 'google' || item === 'discord'),
    ),
  ];
  const initials = (account.name || account.email).trim().slice(0, 2).toUpperCase();
  return (
    <div className="account-page profile-page">
      <section className="card settings-form">
        <div className="account-card-heading">
          <span className="account-icon">
            <UserRound size={19} />
          </span>
          <div>
            <h2>Personal details</h2>
            <p>A familiar identity across every workspace.</p>
          </div>
        </div>
        <div className="profile-identity">
          <span className="avatar" aria-label={`Avatar: ${initials}`}>
            {initials}
          </span>
          <div>
            <strong>{account.name || 'Account owner'}</strong>
            <p>{account.email}</p>
            <span className="account-verification">
              <ShieldCheck size={13} />
              {account.emailVerified ? 'Verified email' : 'Email not verified'}
            </span>
          </div>
        </div>
        <ProfileNameForm name={account.name || ''} />
        {!account.emailVerified && (
          <Link className="text-link" href="/verify-email">
            Verify your email
          </Link>
        )}
        <dl className="account-detail-list">
          <div>
            <dt>Account created</dt>
            <dd>
              <time dateTime={account.createdAt.toISOString()}>
                {account.createdAt.toISOString().slice(0, 10)} UTC
              </time>
            </dd>
          </div>
        </dl>
      </section>
      <section className="card settings-form">
        <div className="account-card-heading">
          <span className="account-icon">
            <KeyRound size={19} />
          </span>
          <div>
            <h2>Sign-in methods</h2>
            <p>Your connected ways to access Assame.</p>
          </div>
        </div>
        <div className="account-method-list">
          <span>
            <KeyRound size={15} />
            {account.passwordHash ? 'Email and password' : 'No password added'}
          </span>
          {providers.map((provider) => (
            <span key={provider}>
              <ProviderIcon provider={provider as 'google' | 'discord'} />
              {provider === 'google' ? 'Google' : 'Discord'}
            </span>
          ))}
        </div>
        <p>Manage connected providers, passwords and active sessions in one place.</p>
        <Link className="btn btn-secondary" href="/settings?tab=security">
          Manage sign-in methods and security
          <ArrowUpRight size={15} />
        </Link>
      </section>
    </div>
  );
}
