import { LegalDocument } from '@/components/legal-document';
import { privacy } from '@/content/legal';
import { publicMetadata } from '@/lib/public-metadata';
export const metadata = publicMetadata(privacy.title, privacy.description, '/privacy');
export default function PrivacyPage() {
  return <LegalDocument document={privacy} />;
}
