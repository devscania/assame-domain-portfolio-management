import ProfilePanel from '@/components/account-settings/profile-panel';
import SecurityPanel from '@/components/account-settings/security-panel';
import WorkspacesPanel from '@/components/account-settings/workspaces-panel';
import { ConsolePage } from '@/components/console-page';
import { MotionPage } from '@/components/motion';

export const metadata = { title: 'Settings', robots: { index: false, follow: false } };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  const selected = typeof tab === 'string' ? tab : undefined;
  let accountPanel;
  switch (selected) {
    case 'profile':
      accountPanel = <ProfilePanel />;
      break;
    case 'security':
      accountPanel = <SecurityPanel />;
      break;
    case 'workspaces':
      accountPanel = <WorkspacesPanel />;
      break;
  }
  return (
    <MotionPage>
      <ConsolePage section="settings" settingsTab={selected} settingsAccountPanel={accountPanel} />
    </MotionPage>
  );
}
