import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/account/',
        '/admin',
        '/overview',
        '/connections',
        '/domains',
        '/listings',
        '/registrars',
        '/sales',
        '/renewals',
        '/analytics',
        '/sync',
        '/settings',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
      ],
    },
    sitemap: `${brand.url}/sitemap.xml`,
  };
}
