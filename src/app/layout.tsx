import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnalyticsController } from '@/components/analytics';
import { Providers } from '@/components/providers';
import { brand } from '@/lib/brand';
import './globals.css';
import './ui-refinement.css';
import './console-refinement.css';
import './account-refinement.css';
import './public-refinement.css';
import './homepage-refinement.css';
import './admin-refinement.css';
import './brand-refinement.css';
import './settings-refinement.css';
import './public-product-refinement.css';
import './financial-trends.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: 'Assame — Domain Portfolio Management Software',
    template: '%s | Assame',
  },
  description: brand.description,
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: 'Assame — Domain Portfolio Management Software',
    description: brand.description,
    url: brand.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Assame — Domain Portfolio Management Software',
    description: brand.description,
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var m=document.cookie.match(/(?:^|;\\s*)assame-account-theme=(light|dark|system)(?:;|$)/);if(m)try{localStorage.setItem('theme',m[1])}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Suspense fallback={null}>
          <AnalyticsController />
        </Suspense>
      </body>
    </html>
  );
}
