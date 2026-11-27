import type { Metadata } from 'next';
import { brand } from './brand';

export function publicMetadata(title: string, description: string, path: string): Metadata {
  const socialTitle = path === '/' ? title : `${title} | ${brand.name}`;
  return {
    title: path === '/' ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: brand.name,
      title: socialTitle,
      description,
      url: path,
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description },
  };
}
