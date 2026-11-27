import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import {
  markWorkspaceNotificationsRead,
  workspaceNotifications,
} from '../src/lib/workspace-notifications';

describe.skipIf(!process.env.TEST_DATABASE_URL)('workspace notifications', () => {
  let org = '',
    owner = '',
    viewer = '',
    otherOrg = '';
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('Dedicated test database required');
    const users = await Promise.all(
      ['owner', 'viewer'].map((role) =>
        db.user.create({
          data: { email: `notice-${role}-${randomUUID()}@example.test` },
        }),
      ),
    );
    owner = users[0].id;
    viewer = users[1].id;
    org = (
      await db.organization.create({
        data: {
          name: 'Notices',
          workspaceOwnerId: owner,
          members: {
            create: [
              { userId: owner, role: 'OWNER' },
              { userId: viewer, role: 'VIEWER' },
            ],
          },
        },
      })
    ).id;
    otherOrg = (
      await db.organization.create({
        data: {
          name: 'Other',
          workspaceOwnerId: owner,
          members: { create: [{ userId: owner, role: 'OWNER' }] },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, viewer] } } });
    await db.$disconnect();
  });
  it('keeps reads and preferences private to each current membership', async () => {
    const createdAt = new Date(Date.now() + 1000);
    const [unread, globallyRead, other] = await Promise.all([
      db.notification.create({ data: { organizationId: org, title: 'Shared update', createdAt } }),
      db.notification.create({
        data: { organizationId: org, title: 'Previously read', createdAt, readAt: new Date() },
      }),
      db.notification.create({ data: { organizationId: otherOrg, title: 'Other', createdAt } }),
    ]);
    expect(await workspaceNotifications(org, viewer)).toEqual([
      { id: unread.id, title: unread.title },
    ]);
    await markWorkspaceNotificationsRead(org, viewer, [unread.id, other.id, globallyRead.id]);
    expect(await workspaceNotifications(org, viewer)).toEqual([]);
    expect(await workspaceNotifications(org, owner)).toEqual([
      { id: unread.id, title: unread.title },
    ]);
    expect(
      await db.notificationRead.count({
        where: { notificationId: { in: [other.id, globallyRead.id] } },
      }),
    ).toBe(0);
    await db.userPreference.create({ data: { userId: owner, notifications: false } });
    expect(await workspaceNotifications(org, owner)).toEqual([]);
    await expect(markWorkspaceNotificationsRead(org, owner, [unread.id])).rejects.toThrow(
      'disabled',
    );
    await db.userPreference.update({ where: { userId: owner }, data: { notifications: true } });
    expect(await workspaceNotifications(org, owner)).toHaveLength(1);
  });
  it('revokes access on removal and does not reveal updates from before rejoining', async () => {
    await db.organizationMember.delete({
      where: { organizationId_userId: { organizationId: org, userId: viewer } },
    });
    await expect(workspaceNotifications(org, viewer)).rejects.toThrow('access changed');
    await expect(markWorkspaceNotificationsRead(org, viewer, ['unrelated'])).rejects.toThrow(
      'access changed',
    );
    await db.organizationMember.create({
      data: {
        organizationId: org,
        userId: viewer,
        role: 'VIEWER',
        joinedAt: new Date(Date.now() + 5000),
      },
    });
    expect(await workspaceNotifications(org, viewer)).toEqual([]);
  });
});
