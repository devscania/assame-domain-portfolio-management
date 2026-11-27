import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/lib/security';
import { migrationReadiness, type MigrationRecord } from '../src/lib/deployment-readiness';

const db = new PrismaClient();
const ids = {
  a: 'restore-owner-a',
  b: 'restore-owner-b',
  first: 'restore-workspace-a',
  second: 'restore-workspace-b',
  other: 'restore-workspace-c',
};
const credential = (scope: string) => ({ apiKey: `synthetic-fixture-${scope}`, scope });

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (
    process.env.ASSAME_BACKUP_REHEARSAL !== 'synthetic-only' ||
    !/^assame-restore-check-[a-f0-9]{12}-(source|restored)$/.test(url.hostname) ||
    url.username !== 'assame_fixture' ||
    url.pathname !== '/assame_fixture'
  )
    throw new Error('Synthetic rehearsal target required');
  if (process.argv[2] === 'seed') {
    assert.equal(await db.user.count(), 0);
    for (const [id, name] of [
      [ids.a, 'مستثمر تجريبي'],
      [ids.b, '検証アカウント'],
    ])
      await db.user.create({
        data: { id, name, email: `${id}@example.test`, emailVerified: new Date() },
      });
    for (const [id, owner, name] of [
      [ids.first, ids.a, 'محفظة أولى'],
      [ids.second, ids.a, 'Second portfolio'],
      [ids.other, ids.b, '別の所有者'],
    ])
      await db.organization.create({
        data: {
          id,
          name,
          workspaceOwnerId: owner,
          members: { create: { userId: owner, role: 'OWNER' } },
        },
      });
    for (const [id, organizationId] of [
      ['restore-domain-a', ids.first],
      ['restore-domain-b', ids.second],
      ['restore-domain-c', ids.other],
    ])
      await db.domain.create({
        data: {
          id,
          organizationId,
          name: 'shared.example',
          unicodeName: 'shared.example',
          tld: 'example',
          acquisitionCost: '12.34',
        },
      });
    await db.domain.create({
      data: {
        id: 'restore-domain-unicode',
        organizationId: ids.first,
        name: 'xn--mgbh0fb.test',
        unicodeName: 'مثال.test',
        tld: 'test',
        notes: { create: { authorId: ids.a, body: 'ملاحظات تجريبية – 東京' } },
      },
    });
    await db.provider.create({
      data: { id: 'restore-fixture-provider', name: 'Synthetic provider', kind: 'registrar' },
    });
    for (const [workspace, scope] of [
      [ids.first, 'a'],
      [ids.other, 'b'],
    ]) {
      await db.providerAccount.create({
        data: {
          id: `restore-provider-${scope}`,
          organizationId: workspace,
          providerId: 'restore-fixture-provider',
          label: 'Synthetic',
          credential: { create: { ciphertext: encrypt(credential(scope)) } },
        },
      });
    }
  } else assert.equal(process.argv[2], 'verify');

  const directory = new URL('../prisma/migrations/', import.meta.url);
  const packaged = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map(async (item) => ({
        name: item.name,
        checksum: createHash('sha256')
          .update(await readFile(new URL(`${item.name}/migration.sql`, directory)))
          .digest('hex'),
      })),
  );
  const ledger = await db.$queryRaw<
    MigrationRecord[]
  >`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  assert.equal(migrationReadiness(packaged, ledger).status, 'pass');
  assert.equal(await db.user.count(), 2);
  assert.equal(await db.organization.count(), 3);
  assert.equal(await db.domain.count(), 4);
  for (const [owner, workspaceCount, domainCount] of [
    [ids.a, 2, 3],
    [ids.b, 1, 1],
  ] as const) {
    assert.equal(
      await db.organizationMember.count({ where: { userId: owner, role: 'OWNER' } }),
      workspaceCount,
    );
    assert.equal(
      await db.domain.count({ where: { organization: { workspaceOwnerId: owner } } }),
      domainCount,
    );
    assert.equal(
      await db.organizationMember.count({
        where: { userId: owner, organization: { workspaceOwnerId: { not: owner } } },
      }),
      0,
    );
  }
  assert.equal(await db.domain.count({ where: { name: 'shared.example' } }), 3);
  assert.equal(
    (
      await db.domain.findUniqueOrThrow({
        where: { id: 'restore-domain-unicode' },
        include: { notes: true },
      })
    ).notes[0].body,
    'ملاحظات تجريبية – 東京',
  );
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: ids.a } })).name, 'مستثمر تجريبي');
  assert.equal(
    (await db.domain.findUniqueOrThrow({ where: { id: 'restore-domain-unicode' } })).unicodeName,
    'مثال.test',
  );
  assert.equal(
    (
      await db.domain.findUniqueOrThrow({ where: { id: 'restore-domain-a' } })
    ).acquisitionCost.toFixed(2),
    '12.34',
  );
  for (const scope of ['a', 'b']) {
    const saved = await db.encryptedCredential.findUniqueOrThrow({
      where: { providerAccountId: `restore-provider-${scope}` },
    });
    assert.equal(saved.keyVersion, 1);
    assert.deepEqual(decrypt(saved.ciphertext), credential(scope));
    const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      process.env.CREDENTIAL_ENCRYPTION_KEY = '0'.repeat(64);
      assert.throws(() => decrypt(saved.ciphertext));
    } finally {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    }
  }
  console.log(
    JSON.stringify({
      migrations: packaged.length,
      accounts: 2,
      workspaces: 3,
      domains: 4,
      encryptedCredentials: 2,
      unicode: true,
      isolation: true,
      correctKey: true,
      wrongKeyRejected: true,
    }),
  );
}

main()
  .catch(() => {
    console.error('Synthetic backup fixture verification failed. Details are suppressed.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
