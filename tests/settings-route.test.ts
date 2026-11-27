import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from '../src/app/(console)/settings/page';
import ProfilePage from '../src/app/(console)/account/profile/page';
import SecurityPage from '../src/app/(console)/account/security/page';
import WorkspacesPage from '../src/app/(console)/account/workspaces/page';

vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock('@/components/motion', () => ({ MotionPage: () => null }));
vi.mock('@/components/console-page', () => ({ ConsolePage: () => null }));
vi.mock('@/components/account-settings/profile-panel', () => ({
  default: function ProfilePanel() {
    return null;
  },
}));
vi.mock('@/components/account-settings/security-panel', () => ({
  default: function SecurityPanel() {
    return null;
  },
}));
vi.mock('@/components/account-settings/workspaces-panel', () => ({
  default: function WorkspacesPanel() {
    return null;
  },
}));
describe('consolidated settings routes', () => {
  it('uses one settings surface for each real account panel', async () => {
    for (const [tab, panel] of [
      ['profile', 'ProfilePanel'],
      ['security', 'SecurityPanel'],
      ['workspaces', 'WorkspacesPanel'],
    ]) {
      const result = await SettingsPage({ searchParams: Promise.resolve({ tab }) });
      const { settingsTab, settingsAccountPanel } = result.props.children.props;
      expect(settingsTab).toBe(tab);
      expect(settingsAccountPanel.type.name).toBe(panel);
    }
  });

  it('redirects older account bookmarks to the corresponding settings tabs', () => {
    expect(ProfilePage).toThrow('/settings?tab=profile');
    expect(SecurityPage).toThrow('/settings?tab=security');
    expect(WorkspacesPage).toThrow('/settings?tab=workspaces');
  });
});
