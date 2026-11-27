import { PasswordChangeForm } from '@/components/password-change-form';
import { PasswordSetup } from '@/components/password-setup';
import { OAuthLinkButtons } from '@/components/oauth-link-buttons';
import { SignOutDevices } from '@/components/sign-out-devices';
import { AccountSessions } from '@/components/account-sessions';
import { AccountRemovalControls } from '@/components/account-removal-controls';
import { context } from '@/lib/access';
import { db } from '@/lib/db';
import { oauthProviders, providerEnabled } from '@/lib/oauth-policy';
export default async function SecurityPanel() {
  const { user } = await context();
  const account = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true, accounts: { select: { provider: true } } },
  });
  const enabled = oauthProviders.filter(providerEnabled);
  const providers = oauthProviders.filter(
    (provider) =>
      enabled.includes(provider) || account.accounts.some((item) => item.provider === provider),
  );
  return (
    <div className="account-page security-page">
      {providers.length > 0 && (
        <section className="card settings-form">
          <h2>Connected sign-in methods</h2>
          <p>
            Connect another provider to this account. Your workspaces remain with your existing
            account.
          </p>
          <OAuthLinkButtons
            providers={providers}
            enabled={enabled}
            linked={account.accounts.map((item) => item.provider)}
          />
        </section>
      )}
      {account.passwordHash && (
        <section className="card settings-form">
          <h2>Change password</h2>
          <p>
            For security, changing your password signs you out on all devices. Sign in again with
            the new password.
          </p>
          <PasswordChangeForm />
        </section>
      )}
      {!account.passwordHash && (
        <section className="card settings-form">
          <h2>Add a password</h2>
          <p>
            We will send a single-use setup link to your verified account email. Setting a password
            signs out existing sessions.
          </p>
          <PasswordSetup />
        </section>
      )}
      <section className="card settings-form account-session-panel">
        <h2>Sessions</h2>
        <AccountSessions />
        <p>
          Sign out every device if you no longer recognize a session. You will need to sign in again
          here.
        </p>
        <SignOutDevices />
      </section>
      <section className="card settings-form account-danger-panel">
        <h2>Remove account</h2>
        <p>Review the effects on your account and workspaces before confirming removal.</p>
        <AccountRemovalControls hasPassword={Boolean(account.passwordHash)} />
      </section>
    </div>
  );
}
