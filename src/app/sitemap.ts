import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';
import { availableProviderIds } from '@/integrations/catalog';
import { articles } from '@/content/articles';
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...[
      '',
      '/features',
      '/integrations',
      '/faq',
      '/contact',
      '/about',
      '/blog',
      '/privacy',
      '/terms',
    ].map((path) => ({ url: `${brand.url}${path}` })),
    ...availableProviderIds.map((provider) => ({ url: `${brand.url}/integrations/${provider}` })),
    ...articles.map((article) => ({
      url: `${brand.url}/blog/${article.slug}`,
      lastModified: article.updatedAt,
    })),
  ];
}
