import { ConsolePage } from '@/components/console-page';
import { MotionPage } from '@/components/motion';
import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view = [] } = await params;
  const section = view[0] === 'connections' ? 'integrations' : view[0] || 'overview';
  if (
    ![
      'overview',
      'domains',
      'listings',
      'registrars',
      'sales',
      'renewals',
      'analytics',
      'sync',
      'integrations',
    ].includes(section) ||
    view.length > 2 ||
    (view.length === 2 && section !== 'domains')
  )
    notFound();
  return (
    <MotionPage>
      <ConsolePage section={section} domainId={section === 'domains' ? view[1] : undefined} />
    </MotionPage>
  );
}
