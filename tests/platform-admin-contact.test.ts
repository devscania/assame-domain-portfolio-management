import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
const state = vi.hoisted(() => ({ userId: '' }));
vi.mock('../src/auth', () => ({
  auth: async () => (state.userId ? { user: { id: state.userId } } : null),
}));
import { PATCH } from '../src/app/api/admin/contacts/route';
import { POST } from '../src/app/api/contact/route';
import { adminContacts } from '../src/lib/platform-admin';

describe.skipIf(!process.env.TEST_DATABASE_URL)('platform contact triage', () => {
  let adminId = '',
    ownerId = '',
    contactId = '';
  const marker = randomUUID(),
    origin = 'http://localhost:3010';
  const req = (body: object, suppliedOrigin = origin) =>
    new Request(`${origin}/api/admin/contacts`, {
      method: 'PATCH',
      headers: { origin: suppliedOrigin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', origin);
    const users = await Promise.all(
      ['admin', 'owner'].map((name) =>
        db.user.create({
          data: { email: `${name}-${marker}@example.test`, emailVerified: new Date() },
        }),
      ),
    );
    [adminId, ownerId] = users.map((user) => user.id);
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', adminId);
  });
  beforeEach(async () => {
    state.userId = adminId;
    contactId = (
      await db.contactRequest.create({
        data: {
          name: 'Contact fixture',
          email: `contact-${marker}@example.test`,
          message: 'Sensitive contact message fixture',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.platformAdminAudit.deleteMany({ where: { resourceId: contactId } });
    await db.contactRequest.deleteMany({ where: { id: contactId } });
  });
  afterAll(async () => {
    await db.platformAdminAudit.deleteMany({ where: { actorId: { in: [adminId, ownerId] } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ownerId] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('denies anonymous, ordinary, unverified and cross-origin requests', async () => {
    const body = { id: contactId, expected: 'new', status: 'in_progress' };
    state.userId = '';
    expect((await PATCH(req(body))).status).toBe(404);
    state.userId = ownerId;
    expect((await PATCH(req(body))).status).toBe(404);
    state.userId = adminId;
    expect((await PATCH(req(body, 'https://attacker.example'))).status).toBe(403);
    await db.user.update({ where: { id: adminId }, data: { emailVerified: null } });
    expect((await PATCH(req(body))).status).toBe(404);
    await db.user.update({ where: { id: adminId }, data: { emailVerified: new Date() } });
    expect((await db.contactRequest.findUniqueOrThrow({ where: { id: contactId } })).status).toBe(
      'new',
    );
    expect(await db.platformAdminAudit.count({ where: { resourceId: contactId } })).toBe(0);
  });
  it('rejects invalid or stale transitions and records exactly one concurrent change', async () => {
    expect((await PATCH(req({ id: contactId, expected: 'new', status: 'delete' }))).status).toBe(
      400,
    );
    expect((await PATCH(req({ id: contactId, expected: 'new', status: 'new' }))).status).toBe(400);
    expect(
      (await PATCH(req({ id: contactId, expected: 'new', status: 'resolved', actorId: ownerId })))
        .status,
    ).toBe(400);
    const responses = await Promise.all([
      PATCH(req({ id: contactId, expected: 'new', status: 'in_progress' })),
      PATCH(req({ id: contactId, expected: 'new', status: 'resolved' })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses[0].headers.get('cache-control')).toBe('private, no-store');
    const result = await db.contactRequest.findUniqueOrThrow({ where: { id: contactId } });
    const logs = await db.platformAdminAudit.findMany({
      where: { actorId: adminId, resourceId: contactId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe(`contact.status.new.${result.status}`);
    expect(JSON.stringify(logs)).not.toContain('Sensitive contact message');
    expect(JSON.stringify(logs)).not.toContain(`contact-${marker}@example.test`);
  });
  it('filters contact requests server-side and audits access', async () => {
    await PATCH(req({ id: contactId, expected: 'new', status: 'resolved' }));
    expect((await adminContacts(1, 'resolved')).some((item) => item.id === contactId)).toBe(true);
    expect((await adminContacts(1, 'new')).some((item) => item.id === contactId)).toBe(false);
    expect(
      await db.platformAdminAudit.count({ where: { actorId: adminId, action: 'contacts.view' } }),
    ).toBeGreaterThanOrEqual(2);
  });
  it('accepts and filters feedback topics without accepting a public refund type', async () => {
    const email = `feedback-${marker}@example.test`;
    const submit = (kind: string) =>
      POST(
        new Request(`${origin}/api/contact`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': marker },
          body: JSON.stringify({
            name: 'Feedback fixture',
            email,
            kind,
            message: 'A feedback request for testing.',
          }),
        }),
      );
    try {
      expect((await submit('bug')).status).toBe(201);
      expect((await submit('feature')).status).toBe(201);
      expect((await submit('refund')).status).toBe(400);
      expect(
        (await adminContacts(1, 'new', 'bug'))
          .filter((item) => item.email === email)
          .map((item) => item.kind),
      ).toEqual(['bug']);
      expect(
        (await adminContacts(1, 'new', 'feature'))
          .filter((item) => item.email === email)
          .map((item) => item.kind),
      ).toEqual(['feature']);
    } finally {
      await db.contactRequest.deleteMany({ where: { email } });
    }
  });
});
