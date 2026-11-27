import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicFrame } from '@/components/public-frame';
import { ProviderLogo } from '@/components/provider-logo';
import { availableProviderIds, isAvailableProvider, providers } from '@/integrations/catalog';
import { providerGuides, providerSetupFaqs } from '@/integrations/guides';
import { publicMetadata } from '@/lib/public-metadata';
import styles from '../provider-guides.module.css';

export const dynamicParams = false;
export function generateStaticParams() {
  return availableProviderIds.map((provider) => ({ provider }));
}
function resolve(id: string) {
  if (!isAvailableProvider(id)) notFound();
  const key = id;
  return { key, provider: providers[key], guide: providerGuides[key] };
}
export async function generateMetadata({ params }: { params: Promise<{ provider: string }> }) {
  const { key, provider } = resolve((await params).provider);
  return publicMetadata(
    `${provider.name} setup guide`,
    `Connect ${provider.name} to Assame: credentials, API eligibility, permissions and supported capabilities.`,
    `/integrations/${key}`,
  );
}
export default async function ProviderGuidePage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { key, provider, guide } = resolve((await params).provider);
  return (
    <PublicFrame>
      <main>
        <section className="public-heading">
          <Link className="text-link" href="/integrations">
            ← All integrations and setup guides
          </Link>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0 16px' }}>
            <ProviderLogo provider={key} size={64} />
          </div>
          <span className="marketing-kicker">PROVIDER SETUP</span>
          <h1>Connect {provider.name}.</h1>
          <p>{provider.description}</p>
        </section>
        <article className={styles.guide}>
          <h2>Before you connect</h2>
          <p>{guide.eligibility}</p>
          <p>
            Choose the workspace that should own this connection. API access remains subject to the
            provider’s current terms and permissions.
          </p>
          <h2>Required fields</h2>
          <dl>
            {guide.fields.map((field) => (
              <div key={field.name}>
                <dt>
                  <strong>{field.name}</strong>
                </dt>
                <dd>{field.description}</dd>
              </div>
            ))}
          </dl>
          <p>
            Add a recognizable account label so you can distinguish multiple connections. Do not put
            a credential in the label.
          </p>
          <h2>Set up the connection</h2>
          <ol>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>
            <Link className="btn btn-primary" href="/connections">
              Open workspace connections
            </Link>
          </p>
          <h2>What Assame supports</h2>
          <p>{guide.limitations}</p>
          <h2>Official instructions</h2>
          <ul>
            {guide.sources.map((source) => (
              <li key={source.url}>
                <a
                  className="text-link"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title} ↗
                </a>
              </li>
            ))}
          </ul>
          <p>
            Provider instructions checked 10 November 2026. Menus, eligibility and permissions can
            change; confirm them in your provider account.
          </p>
          <h2>Connection questions</h2>
          {providerSetupFaqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </article>
      </main>
    </PublicFrame>
  );
}
