import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { isLoopbackFixtureDatabase } from '../scripts/synthetic-database';

describe.skipIf(!process.env.TEST_DATABASE_URL)('operator account creation', () => {
  const email = `operator-${randomUUID()}@example.test`;
  const password = `Account-fixture-${randomUUID()}`;
  const run = (secret = password) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/create-account.ts',
        '--email',
        email.toUpperCase(),
        '--name',
        'Instance owner',
        '--workspace',
        'Personal portfolio',
        '--password-stdin',
      ],
      { input: secret + '\n', encoding: 'utf8', env: process.env },
    );

  beforeAll(() => {
    if (
      process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
      !isLoopbackFixtureDatabase(process.env.TEST_DATABASE_URL)
    )
      throw new Error('Dedicated loopback test database required.');
  });
  afterAll(async () => {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  });
  it('rejects a short password before creating any account', async () => {
    expect(run('short').status).toBe(1);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });
  it('creates a verified password account and owner membership without email services', async () => {
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(password);
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: {
        members: { include: { organization: true } },
      },
    });
    expect(user.emailVerified).toBeInstanceOf(Date);
    expect(await verify(user.passwordHash!, password)).toBe(true);
    expect(user.members).toHaveLength(1);
    expect(user.members[0]).toMatchObject({
      role: 'OWNER',
      organization: {
        name: 'Personal portfolio',
        workspaceOwnerId: user.id,
        demo: false,
      },
    });
  });
  it('rejects duplicate emails without changing existing credentials or adding a workspace', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { email } });
    const result = run(`Different-${randomUUID()}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already exists');
    const after = await db.user.findUniqueOrThrow({ where: { email }, include: { members: true } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.members).toHaveLength(1);
  });
});
