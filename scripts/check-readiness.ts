import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { validateRuntimeConfig } from '../src/lib/runtime-config';
import {
  migrationReadiness,
  operationsReadiness,
  type MigrationRecord,
  type OperationsSnapshot,
  type ReadinessCheck,
} from '../src/lib/deployment-readiness';

const checks: ReadinessCheck[] = [];
try {
  validateRuntimeConfig({ ...process.env, NODE_ENV: 'production' });
  checks.push({
    name: 'production_configuration',
    status: 'pass',
    detail: 'Required configuration passed static validation.',
  });
} catch {
  // Validator details can evolve. Keep operator output independent of secrets.
  checks.push({
    name: 'production_configuration',
    status: 'fail',
    detail:
      'Production configuration is incomplete or invalid. Review the documented required settings.',
  });
}

let client: pg.Client | undefined;
try {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
  client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    application_name: 'assame-readiness',
  });
  const directory = new URL('../prisma/migrations/', import.meta.url);
  const folders = (await readdir(directory, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const migrations = await Promise.all(
    folders.map(async (folder) => ({
      name: folder.name,
      checksum: createHash('sha256')
        .update(await readFile(new URL(`${folder.name}/migration.sql`, directory)))
        .digest('hex'),
    })),
  );
  await client.connect();
  // PostgreSQL enforces read-only behavior, not merely this script's conventions.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '8s'");
  const ledger = await client.query<MigrationRecord>(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
  );
  const migrationCheck = migrationReadiness(migrations, ledger.rows);
  checks.push(
    {
      name: 'database_connection',
      status: 'pass',
      detail: 'Read-only database connection established.',
    },
    migrationCheck,
  );
  if (migrationCheck.status === 'pass') {
    const result = await client.query<OperationsSnapshot>(`
      SELECT current_setting('server_encoding') = 'UTF8' AS utf8,
        current_setting('TimeZone') IN ('UTC', 'Etc/UTC') AS utc,
        EXISTS(SELECT 1 FROM "WorkerHeartbeat" WHERE id='outbox' AND "lastCompletedAt" >= NOW() - INTERVAL '5 minutes') AS "workerRecent",
        (SELECT COUNT(*)::int FROM "SyncJob" WHERE status='queued' AND "createdAt" < NOW() - INTERVAL '15 minutes') AS "oldQueuedJobs",
        (SELECT COUNT(*)::int FROM "SyncJob" WHERE status='running' AND COALESCE("startedAt", "createdAt") < NOW() - INTERVAL '2 hours') AS "oldRunningJobs",
        (SELECT COUNT(*)::int FROM "SyncJob" WHERE status='failed' AND "finishedAt" >= NOW() - INTERVAL '24 hours') AS "failedJobs",
        (SELECT COUNT(*)::int FROM (
          SELECT status, "createdAt" FROM "WelcomeNotice"
          UNION ALL SELECT status, "createdAt" FROM "RenewalReminder"
          UNION ALL SELECT status, "createdAt" FROM "SecurityNotice"
        ) notices WHERE status='pending' AND "createdAt" < NOW() - INTERVAL '15 minutes') AS "oldPendingNotices",
        (SELECT COUNT(*)::int FROM (
          SELECT status FROM "WelcomeNotice"
          UNION ALL SELECT status FROM "RenewalReminder"
          UNION ALL SELECT status FROM "SecurityNotice"
        ) notices WHERE status IN ('failed', 'sending', 'unverified')) AS "uncertainNotices"
    `);
    checks.push(...operationsReadiness(result.rows[0]));
  }
  await client.query('COMMIT');
} catch {
  checks.push({
    name: 'database_inspection',
    status: 'fail',
    detail:
      'Read-only inspection failed or required metadata is unavailable. Check connectivity, read permissions, packaged migrations, and schema currency.',
  });
} finally {
  await client?.end().catch(() => undefined);
}

const failed = checks.some((check) => check.status === 'fail');
console.log(
  JSON.stringify(
    {
      status: failed
        ? 'requires_attention'
        : checks.some((check) => check.status === 'warn')
          ? 'review_warnings'
          : 'operational_checks_passed',
      checkedAt: new Date().toISOString(),
      checks,
      unverified: [
        'HTTPS, DNS, redirects and deployed network access',
        'Independent administrator MFA and access review',
        'Backup restoration and encryption-key recovery',
        'Real OAuth, SMTP and provider behavior',
        'Provider capacity, load testing, legal and retention policy approval',
      ],
    },
    null,
    2,
  ),
);
process.exitCode = failed ? 1 : 0;
