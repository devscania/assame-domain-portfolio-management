import { LegalDocument } from '@/components/legal-document';
import { terms } from '@/content/legal';
import { publicMetadata } from '@/lib/public-metadata';
export const metadata = publicMetadata(terms.title, terms.description, '/terms');
export default function TermsPage() {
  return <LegalDocument document={terms} />;
}
