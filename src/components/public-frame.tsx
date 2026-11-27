import Link from 'next/link';
import { Layers3 } from 'lucide-react';
import { brand } from '@/lib/brand';
import { PublicTheme } from './public-theme';
import { AnalyticsPreferences } from './analytics';
import { PublicAccountMenu } from './public-account-menu';
import { PublicNavigation } from './public-navigation';

export function PublicFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <a className="public-skip-link" href="#public-content">
        Skip to content
      </a>
      <header className="marketing-nav">
        <Link href="/" className="marketing-brand">
          <span>
            <Layers3 size={20} />
          </span>
          {brand.name}
        </Link>
        <PublicNavigation />
        <div className="marketing-actions">
          <PublicTheme />
          <PublicAccountMenu />
        </div>
      </header>
      <div id="public-content" className="public-body" tabIndex={-1}>
        {children}
      </div>
      <footer className="marketing-footer">
        <div>
          <Link href="/" className="marketing-brand">
            <Layers3 size={20} /> Assame
          </Link>
          <p>{brand.tagline}</p>
          <span className="footer-description">A clearer home for your domain portfolio.</span>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <strong>Product</strong>
            <Link href="/features">Features</Link>
            <Link href="/integrations">Integrations</Link>
          </div>
          <div>
            <strong>Explore</strong>
            <Link href="/faq">FAQ</Link>
            <Link href="/about">About</Link>
            <Link href="/blog">Resources</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/contact?topic=bug">Report a bug</Link>
            <Link href="/contact?topic=feature">Request a feature</Link>
          </div>
          <div>
            <strong>Policies</strong>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <AnalyticsPreferences />
          </div>
        </nav>
        <span>© {new Date().getFullYear()} Assame</span>
      </footer>
    </div>
  );
}
