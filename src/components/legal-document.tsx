import Link from 'next/link';
import { PublicFrame } from './public-frame';
import type { LegalDocument as Document } from '@/content/legal';
import { ArrowUpRight, FileText } from 'lucide-react';

export function LegalDocument({ document }: { document: Document }) {
  return (
    <PublicFrame>
      <main>
        <div className="legal-layout">
          <aside className="legal-navigation">
            <span>
              <FileText size={20} /> ASSAME POLICIES
            </span>
            <h2>In this document</h2>
            <nav aria-label="Document sections">
              {document.sections.map((section, index) => (
                <a key={section.heading} href={`#legal-section-${index}`}>
                  {section.heading}
                </a>
              ))}
            </nav>
            <Link href="/contact">
              Have a question? <ArrowUpRight size={15} />
            </Link>
          </aside>
          <article className="editorial-content legal-content">
            <header>
              <span className="marketing-kicker">CLEAR EXPECTATIONS</span>
              <h1>{document.title}</h1>
              <p>
                Last updated: <time dateTime={document.updatedAt}>{document.updatedAt}</time>
              </p>
            </header>
            {document.sections.map((section, index) => (
              <section key={section.heading} id={`legal-section-${index}`}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
            <p>
              <Link className="text-link" href="/contact">
                Contact Assame
              </Link>{' '}
              ·{' '}
              <Link className="text-link" href="/privacy">
                Privacy
              </Link>{' '}
              ·{' '}
              <Link className="text-link" href="/terms">
                Terms
              </Link>
            </p>
          </article>
        </div>
      </main>
    </PublicFrame>
  );
}
