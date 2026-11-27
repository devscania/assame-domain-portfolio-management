import { Reveal } from '@/components/motion';
import Link from 'next/link';
import { PublicFrame } from '@/components/public-frame';
import { publicMetadata } from '@/lib/public-metadata';
export const metadata = publicMetadata(
  'Frequently asked questions',
  'Answers about Assame workspaces, imports and integrations.',
  '/faq',
);
const questions = [
  [
    'Can I manage more than one portfolio?',
    'Yes. Workspaces keep domain data, connections and other portfolio records separate.',
  ],
  [
    'How do I import domains?',
    'You can add domains manually, import a CSV file, or synchronize supported provider inventories. Provider capabilities and permissions differ.',
  ],
];
export default function FAQPage() {
  return (
    <PublicFrame>
      <main>
        <Reveal>
          <section className="public-heading">
            <span className="marketing-kicker">QUESTIONS, ANSWERED</span>
            <h1>Good to know.</h1>
            <p>Practical answers about organizing your domain portfolio with Assame.</p>
          </section>
        </Reveal>
        <div className="faq-layout">
          <aside className="faq-support">
            <span className="marketing-kicker">HERE TO HELP</span>
            <h2>A little clarity goes a long way.</h2>
            <p>Learn how accounts, workspaces and integrations fit together.</p>
            <Link href="/contact" className="marketing-outline">
              Contact Assame →
            </Link>
          </aside>
          <section className="faq-list">
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
            <details>
              <summary>Where do I find my provider API credentials?</summary>
              <p>
                Each registrar and marketplace has its own access requirements. Our provider guides
                explain where to create credentials, which read permissions to choose, and how to
                resolve common connection problems.
              </p>
              <Link className="text-link" href="/integrations">
                Browse provider setup guides →
              </Link>
            </details>
            <p>
              Need to discuss a larger portfolio?{' '}
              <Link className="text-link" href="/contact">
                Contact us
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
    </PublicFrame>
  );
}
