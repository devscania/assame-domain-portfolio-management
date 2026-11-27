import { Reveal } from '@/components/motion';
import Link from 'next/link';
import { PublicFrame } from '@/components/public-frame';
import { articles } from '@/content/articles';
import { publicMetadata } from '@/lib/public-metadata';
import { BookOpen, ArrowUpRight } from 'lucide-react';

export const metadata = publicMetadata(
  'Resources',
  'Practical guides for organizing and managing domain portfolios.',
  '/blog',
);

export default function BlogPage() {
  return (
    <PublicFrame>
      <main>
        <Reveal>
          <section className="public-heading">
            <span className="marketing-kicker">ASSAME RESOURCES</span>
            <h1>Make more of your portfolio.</h1>
            <p>Practical guides for organizing and managing your domains.</p>
          </section>
        </Reveal>
        <Reveal>
          <section className="editorial-list" aria-label="Articles">
            {articles.map((article) => (
              <article key={article.slug}>
                <div className="resource-card-top">
                  <span>
                    <BookOpen size={17} /> PORTFOLIO GUIDE
                  </span>
                  <time dateTime={article.publishedAt}>{article.publishedAt}</time>
                </div>
                <h2>
                  <Link href={`/blog/${article.slug}`}>{article.title}</Link>
                </h2>
                <p>{article.description}</p>
                <Link className="text-link" href={`/blog/${article.slug}`}>
                  Read guide <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
