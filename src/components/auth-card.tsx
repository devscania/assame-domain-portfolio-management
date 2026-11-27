import Link from 'next/link';
import { KeyRound, Layers3, LoaderCircle, Mail, ShieldAlert } from 'lucide-react';
import { brand } from '@/lib/brand';
import { PublicAccountMenu } from './public-account-menu';
import { PublicTheme } from './public-theme';
import { Reveal } from './motion';

export function AuthCard({
  title,
  children,
  kind = 'security',
}: {
  title: string;
  children: React.ReactNode;
  kind?: 'security' | 'email' | 'danger' | 'progress';
}) {
  const Icon =
    kind === 'email'
      ? Mail
      : kind === 'danger'
        ? ShieldAlert
        : kind === 'progress'
          ? LoaderCircle
          : KeyRound;
  return (
    <main className="auth-recovery">
      <Reveal className={`auth-recovery-card auth-card-${kind}`} inView={false}>
        <div className="auth-card-top">
          <Link className="marketing-brand" href="/" aria-label={`${brand.name} home`}>
            <span>
              <Layers3 size={19} aria-hidden="true" />
            </span>
            {brand.name}
          </Link>
          <div className="auth-card-actions">
            <PublicTheme />
            <PublicAccountMenu guestLinks={false} />
          </div>
        </div>
        <div className="auth-card-symbol">
          <Icon size={25} aria-hidden="true" />
        </div>
        <span className="auth-card-eyebrow">YOUR ASSAME ACCOUNT</span>
        <h1>{title}</h1>
        {children}
      </Reveal>
    </main>
  );
}
