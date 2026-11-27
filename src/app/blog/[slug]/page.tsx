import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicFrame } from '@/components/public-frame';
import { articles, getArticle } from '@/content/articles';
import { brand } from '@/lib/brand';
import { publicMetadata } from '@/lib/public-metadata';
import { Reveal } from '@/components/motion';

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() {
  return articles.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = getArticle((await params).slug);
  if (!article) return { title: 'Article not found', robots: { index: false, follow: false } };
  const path = `/blog/${article.slug}`;
  const base = publicMetadata(article.title, article.description, path);
  return {
    ...base,
    openGraph: {
      type: 'article',
      siteName: brand.name,
      title: `${article.title} | ${brand.name}`,
      description: article.description,
      url: path,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    },
  };
}
export default async function ArticlePage({ params }: Props) {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: { '@type': 'Organization', name: brand.name },
    publisher: { '@type': 'Organization', name: brand.name },
    mainEntityOfPage: `${brand.url}/blog/${article.slug}`,
  };
  return (
    <PublicFrame>
      <main>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
        <Reveal>
          <article className="editorial-content resource-article">
            <Link className="text-link" href="/blog">
              ← All resources
            </Link>
            <header>
              <span className="marketing-kicker">PORTFOLIO MANAGEMENT</span>
              <h1>{article.title}</h1>
              <p>{article.description}</p>
              <p>
                <time dateTime={article.publishedAt}>{article.publishedAt}</time> · Assame
              </p>
            </header>
            {article.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
            <footer className="resource-article-footer">
              <span className="marketing-kicker">YOUR NEXT STEP</span>
              <h2>Put a clearer process in place.</h2>
              <p>Explore the tools for bringing your portfolio together.</p>
              <Link className="text-link" href="/features">
                Explore Assame features →
              </Link>
            </footer>
          </article>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
