import { Reveal } from '@/components/motion';
import Link from 'next/link';
import { ArrowRight, BookOpen, KeyRound, ShieldCheck } from 'lucide-react';
import { ProviderLogo } from '@/components/provider-logo';
import { ProviderCapabilities } from '@/components/provider-capabilities';
import { providerSetupFaqs } from '@/integrations/guides';
import { availableProviderIds, providers } from '@/integrations/catalog';
import { PublicFrame } from '@/components/public-frame';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata = publicMetadata(
  'Integrations',
  'See the registrars and marketplaces supported by Assame, and understand provider limitations.',
  '/integrations',
);
export default async function IntegrationsPage() {
  return (
    <PublicFrame>
      <main>
        <Reveal>
          <section className="public-heading">
            <span className="marketing-kicker">CONNECTED PORTFOLIOS</span>
            <h1>Your sources, together.</h1>
            <p>
              Connect supported registrars and marketplaces, or bring a portfolio in with CSV. Each
              provider exposes a different set of capabilities.
            </p>
          </section>
        </Reveal>
        <Reveal>
          <section className="integration-public-grid">
            {availableProviderIds.map((id) => {
              const provider = providers[id];
              return (
                <article className="public-provider" key={id}>
                  <ProviderLogo provider={id} size={44} />
                  <div>
                    <h2>{provider.name}</h2>
                    <p>{provider.description}</p>
                    <small>Supported · {provider.kind}</small>
                    <ProviderCapabilities provider={id} />
                    <Link className="text-link" href={`/integrations/${id}`}>
                      Setup guide and permissions →
                    </Link>
                  </div>
                </article>
              );
            })}
            <article className="public-provider">
              <ProviderLogo provider="csv" size={44} />
              <div>
                <h2>CSV import</h2>
                <p>Bring in domain data from a file and export your portfolio.</p>
                <small>Available · File import</small>
                <p>
                  <Link
                    className="text-link"
                    href="/blog/organize-domain-portfolios-across-workspaces"
                  >
                    CSV and workspace guide →
                  </Link>
                </p>
              </div>
            </article>
          </section>
        </Reveal>
        <Reveal>
          <section className="pricing-notes">
            <div>
              <h2>Permissions matter.</h2>
              <p>
                Provider access, rate limits, available data and remote-write capabilities vary.
                Some actions require additional permissions, explicit confirmation and workspace
                opt-in.
              </p>
            </div>
            <div>
              <h2>Keep portfolios separate.</h2>
              <p>
                Connections belong to a workspace, so credentials and synchronized data remain
                associated with the portfolio they serve.
              </p>
              <Link className="text-link" href="/register">
                Create a workspace →
              </Link>
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section
            className="provider-connection-guide"
            aria-labelledby="provider-connection-title"
          >
            <aside className="provider-guide-intro">
              <span className="provider-guide-symbol">
                <BookOpen size={25} aria-hidden="true" />
              </span>
              <span className="marketing-kicker">A CLEARER CONNECTION</span>
              <h2 id="provider-connection-title">Before you connect.</h2>
              <p>
                A little context makes setup simpler. Start with the provider’s guide, then check
                the access and permissions available to your account.
              </p>
              <div className="provider-guide-checkpoint">
                <KeyRound size={18} aria-hidden="true" />
                <span>
                  Use the right credentials<small>Requirements differ for each provider.</small>
                </span>
              </div>
              <div className="provider-guide-checkpoint">
                <ShieldCheck size={18} aria-hidden="true" />
                <span>
                  Understand the permissions
                  <small>Available data and supported actions vary.</small>
                </span>
              </div>
              <Link className="text-link" href="/contact">
                Need a hand with setup? <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </aside>
            <div className="provider-guide-questions">
              <span className="marketing-kicker">SETUP QUESTIONS, ANSWERED</span>
              <h3>Connecting your providers</h3>
              <div className="faq-list">
                {providerSetupFaqs.map((faq) => (
                  <details key={faq.question}>
                    <summary>{faq.question}</summary>
                    <p>{faq.answer}</p>
                  </details>
                ))}
              </div>
              <p className="provider-relationship-note">
                Provider logos identify compatible services; they do not imply affiliation or
                endorsement. API eligibility and terms remain provider-specific.
              </p>
            </div>
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
