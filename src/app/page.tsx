import { Reveal } from '@/components/motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomeDashboardPreview } from '@/components/home-dashboard-preview';
import { HomePortfolioStory } from '@/components/home-portfolio-story';
import { PublicFrame } from '@/components/public-frame';
import { publicMetadata } from '@/lib/public-metadata';
import { ProviderLogo } from '@/components/provider-logo';
import { brand } from '@/lib/brand';

export const metadata = publicMetadata(
  'Assame — Domain Portfolio Management Software',
  'Manage domains across registrars and marketplaces in one workspace. Track renewals, synchronize listings, monitor sales, and organize your domain portfolio with Assame.',
  '/',
);

export const dynamic = 'force-dynamic';
export default async function Home() {
  return (
    <PublicFrame>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              { '@type': 'Organization', name: brand.name, url: brand.url },
              {
                '@type': 'WebApplication',
                name: brand.name,
                url: brand.url,
                applicationCategory: 'BusinessApplication',
                operatingSystem: 'Web',
                description:
                  'Manage your domain portfolio across registrars and marketplaces in one workspace.',
              },
            ],
          }).replace(/</g, '\\u003c'),
        }}
      />
      <main className="home-refined">
        <Reveal>
          <section className="marketing-hero">
            <div className="hero-copy">
              <span className="marketing-kicker">DOMAIN PORTFOLIO MANAGEMENT</span>
              <h1>
                Every domain.
                <br />
                <em>One place.</em>
              </h1>
              <p>
                Manage your domains, listings, renewals, and sales across registrars and
                marketplaces — all in one powerful workspace.
              </p>
              <div className="hero-actions">
                <Link className="marketing-button" href="/register">
                  Create an account <ArrowRight size={16} />
                </Link>
                <a className="marketing-outline" href="#features">
                  Explore features
                </a>
              </div>
              <div className="hero-note">
                <span /> A clearer view of your portfolio
              </div>
            </div>
            <HomeDashboardPreview />
          </section>
        </Reveal>
        <HomePortfolioStory />
        <Reveal>
          <section className="home-how" aria-labelledby="home-how-title">
            <div className="home-section-heading">
              <span className="marketing-kicker">HOW IT WORKS</span>
              <h2 id="home-how-title">A simpler way to see the whole portfolio.</h2>
              <p>
                Start with the domains you have and bring the details together at your own pace.
              </p>
            </div>
            <ol className="home-steps">
              <li>
                <span>01</span>
                <h3>Create a workspace</h3>
                <p>Give each portfolio its own place, from personal investments to client work.</p>
              </li>
              <li>
                <span>02</span>
                <h3>Add your domains</h3>
                <p>Enter them manually, import a CSV, or connect a supported provider.</p>
              </li>
              <li>
                <span>03</span>
                <h3>Keep track</h3>
                <p>
                  Review listings, renewal dates and recorded sales alongside your domain inventory.
                </p>
              </li>
            </ol>
          </section>
        </Reveal>
        <Reveal>
          <section className="home-workspaces" aria-labelledby="home-workspaces-title">
            <div className="home-workspaces-copy">
              <span className="marketing-kicker">ROOM FOR EVERY PORTFOLIO</span>
              <h2 id="home-workspaces-title">Separate workspaces. One account.</h2>
              <p>
                Keep domains, connections, finances and members in the workspace they belong to.
                Switch between portfolios without mixing their records.
              </p>
              <Link className="text-link" href="/features">
                Explore workspace features <ArrowRight size={15} />
              </Link>
            </div>
            <div
              className="home-workspace-preview"
              aria-label="Illustrative workspace management preview"
            >
              <div className="home-preview-title">
                <span>WORKSPACES</span>
                <span>Manage portfolios</span>
              </div>
              <div className="home-preview-row">
                <span className="home-preview-icon">P</span>
                <div>
                  <strong>Personal portfolio</strong>
                  <small>Owner · Your workspace</small>
                </div>
                <span className="home-preview-current">Current</span>
              </div>
              <div className="home-preview-row">
                <span className="home-preview-icon">C</span>
                <div>
                  <strong>Client portfolio</strong>
                  <small>Separate workspace</small>
                </div>
                <span>→</span>
              </div>
              <div className="home-preview-note">Keep separate portfolios under one sign-in.</div>
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section className="marketing-dark" id="integrations">
            <div>
              <span className="marketing-kicker">CONNECTED BY DESIGN</span>
              <h2>
                Your portfolio has many sources.
                <br />
                Your view can be one.
              </h2>
              <p>
                Bring supported registrar and marketplace data together, or use CSV import to get
                started. Provider capabilities and permissions vary.
              </p>
              <Link className="marketing-button" href="/login">
                Open your workspace <ArrowRight size={16} />
              </Link>
            </div>
            <div className="provider-list">
              {(
                [
                  ['afternic', 'Afternic', 'Marketplace'],
                  ['spaceship', 'Spaceship', 'Registrar & marketplace'],
                  ['dynadot', 'Dynadot', 'Registrar & marketplace'],
                  ['atom', 'Atom', 'Marketplace'],
                  ['csv', 'CSV import', 'File import'],
                ] as const
              ).map(([provider, name, category]) => (
                <span key={provider}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                    <ProviderLogo provider={provider} size={28} />
                    {name}
                  </span>
                  <small>{category}</small>
                </span>
              ))}
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section className="home-trust" aria-labelledby="home-trust-title">
            <span className="marketing-kicker">BUILT FOR CONTROL</span>
            <h2 id="home-trust-title">Your portfolio stays yours.</h2>
            <p>
              Workspace permissions protect access to your portfolio, provider credentials are
              encrypted, and supported provider changes require an explicit preview and
              confirmation.
            </p>
            <Link className="text-link" href="/privacy">
              Read our privacy policy <ArrowRight size={15} />
            </Link>
          </section>
        </Reveal>
        <Reveal>
          <section className="faq-list home-faq" aria-labelledby="home-faq-title">
            <span className="marketing-kicker">COMMON QUESTIONS</span>
            <h2 id="home-faq-title">Good to know.</h2>
            <details>
              <summary>Can I work across multiple registrars?</summary>
              <p>
                Yes. Connect supported providers using your own accounts, import a CSV or enter
                domains manually. Provider capabilities and permissions vary.
              </p>
            </details>
            <p>
              <Link className="text-link" href="/faq">
                See all questions <ArrowRight size={15} />
              </Link>
            </p>
          </section>
        </Reveal>
        <Reveal>
          <section className="marketing-end">
            <span className="marketing-kicker">READY FOR A CLEARER VIEW?</span>
            <h2>Make room for what’s next.</h2>
            <p>Bring your domain portfolio together with Assame.</p>
            <Link className="marketing-button" href="/register">
              Create an account <ArrowRight size={16} />
            </Link>
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
