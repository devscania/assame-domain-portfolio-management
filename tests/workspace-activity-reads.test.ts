import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import {
  markWorkspaceActivityRead,
  unreadWorkspaceActivityCount,
  workspaceActivity,
} from '../src/lib/workspace-activity';
import { workspaceNotifications } from '../src/lib/workspace-notifications';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Activity Center unread history', () => {
  let workspace = '';
  let otherWorkspace = '';
  let owner = '';
  let viewer = '';
  const joinedAt = new Date('2026-01-02T00:00:00Z');
  const activityAt = new Date('2026-01-03T00:00:00Z');

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    owner = (await db.user.create({ data: { email: `activity-${randomUUID()}@example.test` } })).id;
    viewer = (await db.user.create({ data: { email: `activity-${randomUUID()}@example.test` } }))
      .id;
    workspace = (
      await db.organization.create({
        data: {
          name: 'Activity Center fixture',
          members: {
            create: [
              { userId: owner, role: 'OWNER', joinedAt },
              { userId: viewer, role: 'VIEWER', joinedAt },
            ],
          },
        },
      })
    ).id;
    otherWorkspace = (await db.organization.create({ data: { name: 'Other activity workspace' } }))
      .id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [workspace, otherWorkspace] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, viewer] } } });
    await db.$disconnect();
  });

  it('acknowledges only shown, relevant activity for the current membership and preserves the bell', async () => {
    const event = await db.auditLog.create({
      data: {
        organizationId: workspace,
        actorId: owner,
        action: 'domain.created',
        createdAt: activityAt,
      },
    });
    const hidden = await db.auditLog.create({
      data: {
        organizationId: workspace,
        actorId: owner,
        action: 'domain.status_updated',
        detail: { source: 'manual-bulk' },
        createdAt: activityAt,
      },
    });
    const other = await db.auditLog.create({
      data: {
        organizationId: otherWorkspace,
        actorId: owner,
        action: 'domain.created',
        createdAt: activityAt,
      },
    });
    const older = await db.auditLog.create({
      data: {
        organizationId: workspace,
        actorId: owner,
        action: 'domain.created',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: workspace,
        actorId: owner,
        action: 'internal.unrelated',
        createdAt: activityAt,
      },
    });
    await db.notification.create({
      data: { organizationId: workspace, title: 'Bell-only notice', createdAt: activityAt },
    });

    expect(await unreadWorkspaceActivityCount(workspace, viewer)).toBe(1);
    expect(
      (await workspaceActivity(workspace, 100, viewer)).map(({ id, unread }) => ({ id, unread })),
    ).toEqual([
      { id: event.id, unread: true },
      { id: older.id, unread: false },
    ]);

    // This event arrives after the Activity Center fetched the displayed IDs.
    const arriving = await db.auditLog.create({
      data: {
        organizationId: workspace,
        actorId: owner,
        action: 'payment.recorded',
        createdAt: new Date('2026-01-04T00:00:00Z'),
      },
    });
    await markWorkspaceActivityRead(workspace, viewer, [
      event.id,
      event.id,
      hidden.id,
      other.id,
      older.id,
    ]);
    expect(await unreadWorkspaceActivityCount(workspace, viewer)).toBe(1);
    expect(await unreadWorkspaceActivityCount(workspace, owner)).toBe(2);
    expect(
      (await workspaceActivity(workspace, 100, viewer)).find(({ id }) => id === arriving.id)
        ?.unread,
    ).toBe(true);
    expect(
      await db.$queryRaw<
        { activityId: string }[]
      >`SELECT "activityId" FROM "WorkspaceActivityRead" WHERE "activityId" IN (${event.id}, ${hidden.id}, ${other.id}, ${older.id})`,
    ).toEqual([{ activityId: event.id }]);
    expect(await workspaceNotifications(workspace, viewer)).toHaveLength(1);

    await db.userPreference.create({ data: { userId: viewer, notifications: false } });
    expect(await unreadWorkspaceActivityCount(workspace, viewer)).toBe(0);
    expect(
      (await workspaceActivity(workspace, 100, viewer)).find(({ id }) => id === arriving.id)
        ?.unread,
    ).toBe(true);

    await db.organizationMember.delete({
      where: { organizationId_userId: { organizationId: workspace, userId: viewer } },
    });
    await expect(markWorkspaceActivityRead(workspace, viewer, [arriving.id])).rejects.toThrow(
      'access changed',
    );
  });
});
