import { context } from '@/lib/access';
import { db } from '@/lib/db';
import { TransferAction, TransferRequest } from '@/components/workspace-transfer';
import { OpenWorkspace } from '@/components/open-workspace';
import { workspaceOverview } from '@/lib/workspace-overview';

export default async function WorkspacesPanel() {
  const { user } = await context();
  const [overview, incoming, outgoing] = await Promise.all([
    workspaceOverview(user.id!),
    db.workspaceTransfer.findMany({
      where: { toUserId: user.id, status: 'pending', expiresAt: { gt: new Date() } },
      include: { organization: { select: { name: true } }, fromUser: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.workspaceTransfer.findMany({
      where: { fromUserId: user.id, status: 'pending', expiresAt: { gt: new Date() } },
      include: { organization: { select: { name: true } }, toUser: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return (
    <div className="account-page workspaces-page">
      {incoming.map((item) => (
        <section className="card settings-form" key={item.id}>
          <h2>Ownership request: {item.organization.name}</h2>
          <p>
            {item.fromUser.email} requests that you take ownership of this workspace. The current
            owner will remain an administrator.
          </p>
          <p>Expires {item.expiresAt.toISOString().slice(0, 10)} UTC.</p>
          <TransferAction action="accept" transferId={item.id} />
          <TransferAction action="decline" transferId={item.id} />
        </section>
      ))}
      {outgoing.map((item) => (
        <section className="card settings-form" key={item.id}>
          <h2>Pending: {item.organization.name}</h2>
          <p>
            Awaiting {item.toUser.email} until {item.expiresAt.toISOString().slice(0, 10)} UTC.
          </p>
          <TransferAction action="cancel" transferId={item.id} />
        </section>
      ))}
      {overview.memberships.map(({ organization, role }) => {
        const details = overview.owned.find((item) => item.id === organization.id);
        return (
          <section className="card settings-form" key={organization.id}>
            <h2>{organization.name}</h2>
            <p>
              Your role: {role.toLowerCase()}
              {organization.workspaceOwnerId === user.id ? ' · Workspace owner' : ''}
            </p>
            <OpenWorkspace id={organization.id} />
            {details && (
              <>
                <p>Active domains: {details.domains.toLocaleString()}</p>
                <p>
                  Connected integrations:{' '}
                  {details.integrationCount === 0
                    ? 'None'
                    : `${details.integrations.join(', ')} (${details.integrationCount} connected account${details.integrationCount === 1 ? '' : 's'})`}
                  {details.integrationCount > 20 ? ' · showing the first 20 connections' : ''}
                </p>
                <p>
                  Last successful sync:{' '}
                  {details.lastSyncAt
                    ? `${details.lastSyncAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
                    : 'None yet'}
                </p>
                <div>
                  <p>Members: {details.memberCount}</p>
                  <ul>
                    {details.members.map((member) => (
                      <li key={member.user.email}>
                        {member.user.name
                          ? `${member.user.name} (${member.user.email})`
                          : member.user.email}{' '}
                        · {member.role.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                  {details.memberCount > details.members.length && (
                    <p>
                      Showing the first {details.members.length} members. Open the workspace to
                      manage the full team.
                    </p>
                  )}
                </div>
              </>
            )}
            {role === 'OWNER' &&
              organization.workspaceOwnerId === user.id &&
              !outgoing.some((item) => item.organizationId === organization.id) && (
                <TransferRequest organizationId={organization.id} name={organization.name} />
              )}
          </section>
        );
      })}
    </div>
  );
}
