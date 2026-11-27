import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { POST } from '../src/app/api/contact/route';

describe.skipIf(!process.env.TEST_DATABASE_URL)('public contact requests', () => {
  const email = `contact-${randomUUID()}@example.test`;
  const testAddress = randomUUID();
  const request = (body: object, origin = 'http://localhost:3000') =>
    new Request('http://localhost:3000/api/contact', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': testAddress },
      body: JSON.stringify(body),
    });
  beforeAll(() => {
    if (process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('A dedicated test database is required');
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
  });
  afterAll(async () => {
    await db.contactRequest.deleteMany({ where: { email } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it('stores a valid request without exposing it in the response', async () => {
    const response = await POST(
      request({
        name: 'Portfolio owner',
        email,
        message: 'Please contact me about portfolio setup.',
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(await db.contactRequest.findFirst({ where: { email } })).toMatchObject({
      name: 'Portfolio owner',
      status: 'new',
    });
  });
  it('rejects invalid input and forged origins', async () => {
    expect((await POST(request({ name: 'A', email, message: 'short' }))).status).toBe(400);
    expect(
      (
        await POST(
          request(
            { name: 'A', email, message: 'This is a valid length.' },
            'https://attacker.example',
          ),
        )
      ).status,
    ).toBe(403);
    expect(await db.contactRequest.count({ where: { email } })).toBe(1);
  });
});
