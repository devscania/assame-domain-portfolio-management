// This drill never loads .env or accepts an existing database address.
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerImage = process.argv[2];
if (
  process.argv.length !== 3 ||
  !workerImage ||
  !/^[A-Za-z0-9][A-Za-z0-9./:@_-]+$/.test(workerImage)
) {
  console.error('Usage: npm run backup:rehearse -- <locally-built-worker-image>');
  process.exit(1);
}
const prefix = `assame-restore-check-${randomBytes(6).toString('hex')}`;
const network = `${prefix}-net`;
const source = `${prefix}-source`,
  restored = `${prefix}-restored`;
const password = randomBytes(24).toString('hex'),
  encryptionKey = randomBytes(32).toString('hex');
const temporary = mkdtempSync(path.join(tmpdir(), 'assame-backup-rehearsal-'));
const archive = path.join(temporary, 'fixture.dump');
const owned = [];
let networkCreated = false;
let failed = false;
const steps = [];

function docker(operation, args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 2_000_000,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${operation} failed; Docker output is suppressed.`);
  return result.stdout.trim();
}
function environment(host) {
  return [
    '--env',
    `DATABASE_URL=postgresql://assame_fixture:${password}@${host}:5432/assame_fixture`,
    '--env',
    `CREDENTIAL_ENCRYPTION_KEY=${encryptionKey}`,
    '--env',
    'ASSAME_BACKUP_REHEARSAL=synthetic-only',
    '--env',
    'PROVIDER_WRITES_ENABLED=false',
    '--env',
    'DEMO_MODE=false',
  ];
}
function fixture(host, mode) {
  const utility = `${prefix}-${mode}-${host === source ? 'source' : 'restored'}`;
  docker('Create fixture verifier', [
    'create',
    '--pull=never',
    '--name',
    utility,
    '--network',
    network,
    ...environment(host),
    workerImage,
    'node',
    '--import',
    'tsx',
    'scripts/backup-rehearsal-fixture.ts',
    mode,
  ]);
  owned.push(utility);
  docker('Copy fixture verifier', [
    'cp',
    fileURLToPath(new URL('./backup-rehearsal-fixture.ts', import.meta.url)),
    `${utility}:/app/scripts/backup-rehearsal-fixture.ts`,
  ]);
  const output = docker('Run fixture verifier', ['start', '--attach', utility]);
  // docker start can return successfully for an exited command; inspect its code.
  if (
    docker('Inspect verifier result', ['inspect', '--format', '{{.State.ExitCode}}', utility]) !==
    '0'
  )
    throw new Error('Synthetic fixture verification failed; details are suppressed.');
  const report = JSON.parse(output.split('\n').at(-1));
  if (!report.correctKey || !report.wrongKeyRejected || !report.isolation || !report.unicode)
    throw new Error('Synthetic fixture checks did not pass.');
  return report;
}

try {
  docker('Inspect worker image', ['image', 'inspect', workerImage, '--format', '{{.Id}}']);
  docker('Inspect PostgreSQL image', [
    'image',
    'inspect',
    'postgres:18-bookworm',
    '--format',
    '{{.Id}}',
  ]);
  docker('Create isolated network', ['network', 'create', '--internal', network]);
  networkCreated = true;
  console.log(
    'Starting a synthetic-only backup drill on an internal Docker network. No configured database is used.',
  );
  for (const container of [source, restored]) {
    docker('Start disposable PostgreSQL', [
      'run',
      '--detach',
      '--pull=never',
      '--name',
      container,
      '--network',
      network,
      '--env',
      'POSTGRES_USER=assame_fixture',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--env',
      'POSTGRES_DB=assame_fixture',
      '--env',
      'POSTGRES_INITDB_ARGS=--encoding=UTF8',
      'postgres:18-bookworm',
    ]);
    owned.push(container);
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      const probe = spawnSync(
        'docker',
        ['exec', container, 'pg_isready', '-U', 'assame_fixture', '-d', 'assame_fixture'],
        { stdio: 'ignore', timeout: 5000 },
      );
      ready = probe.status === 0;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Disposable PostgreSQL startup timed out.');
  }
  const migrate = `${prefix}-migrate`;
  docker('Apply migrations', [
    'create',
    '--pull=never',
    '--name',
    migrate,
    '--network',
    network,
    ...environment(source),
    workerImage,
    'node',
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
  ]);
  owned.push(migrate);
  docker('Run migrations', ['start', '--attach', migrate]);
  if (
    docker('Inspect migration result', ['inspect', '--format', '{{.State.ExitCode}}', migrate]) !==
    '0'
  )
    throw new Error('Disposable migration deployment failed.');
  const before = fixture(source, 'seed');
  steps.push('source_fixture_verified');
  docker('Create custom archive', [
    'exec',
    source,
    'pg_dump',
    '--username=assame_fixture',
    '--dbname=assame_fixture',
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file=/tmp/fixture.dump',
  ]);
  docker('Copy synthetic archive', ['cp', `${source}:/tmp/fixture.dump`, archive]);
  chmodSync(archive, 0o600);
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  docker('Transfer synthetic archive', ['cp', archive, `${restored}:/tmp/fixture.dump`]);
  const transferred = docker('Verify archive transfer', [
    'exec',
    restored,
    'sha256sum',
    '/tmp/fixture.dump',
  ]).split(/\s/)[0];
  if (checksum !== transferred) throw new Error('Synthetic archive transfer checksum mismatch.');
  steps.push('custom_archive_transfer_verified');
  docker('Restore separate fresh database', [
    'exec',
    restored,
    'pg_restore',
    '--username=assame_fixture',
    '--dbname=assame_fixture',
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-acl',
    '/tmp/fixture.dump',
  ]);
  const after = fixture(restored, 'verify');
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Restored aggregate checks differ.');
  steps.push('restored_fixture_verified');
  console.log(
    JSON.stringify({
      status: 'synthetic_restore_passed',
      ...after,
      steps,
      unverified: [
        'Actual customer backup and off-host storage recovery',
        'Production roles, grants, extensions, TLS and key custody',
        'Point-in-time recovery, recovery deadlines and retention policy',
      ],
    }),
  );
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : 'Synthetic backup rehearsal failed.');
} finally {
  for (const container of owned.reverse()) {
    try {
      docker('Remove owned container', ['rm', '--force', '--volumes', container]);
    } catch {
      failed = true;
      console.error('An owned rehearsal container could not be removed. Inspect task resources.');
    }
  }
  if (networkCreated) {
    try {
      docker('Remove owned network', ['network', 'rm', network]);
    } catch {
      failed = true;
      console.error('The owned rehearsal network could not be removed.');
    }
  }
  // Exact generated file/directory only; no recursive filesystem deletion.
  try {
    rmSync(archive, { force: true });
    rmdirSync(temporary);
  } catch {
    failed = true;
    console.error('The synthetic temporary archive could not be removed.');
  }
  console.log(
    failed
      ? 'Rehearsal failed or cleanup requires inspection.'
      : 'Owned rehearsal containers, anonymous volumes, network and temporary archive removed.',
  );
}
process.exitCode = failed ? 1 : 0;
