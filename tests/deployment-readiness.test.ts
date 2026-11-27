import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  migrationReadiness,
  operationsReadiness,
  type OperationsSnapshot,
} from '../src/lib/deployment-readiness';

describe('read-only deployment readiness', () => {
  it('rejects pending, failed, modified and unexpected migration artifacts while allowing a completed rollback retry', () => {
    const expected = [
      { name: 'first', checksum: 'a' },
      { name: 'second', checksum: 'b' },
    ];
    const completed = (migration_name: string, checksum: string) => ({
      migration_name,
      checksum,
      finished_at: new Date(),
      rolled_back_at: null,
    });
    expect(migrationReadiness(expected, [completed('first', 'a')]).status).toBe('fail');
    expect(
      migrationReadiness(expected, [completed('first', 'changed'), completed('second', 'b')])
        .detail,
    ).toContain('1 checksum mismatches');
    expect(
      migrationReadiness(expected, [
        completed('first', 'a'),
        completed('second', 'b'),
        completed('third', 'c'),
      ]).detail,
    ).toContain('1 database-only');
    const failed = {
      migration_name: 'second',
      checksum: 'b',
      finished_at: null,
      rolled_back_at: null,
    };
    expect(migrationReadiness(expected, [completed('first', 'a'), failed]).detail).toContain(
      '1 unfinished',
    );
    expect(
      migrationReadiness(expected, [
        completed('first', 'a'),
        { ...failed, rolled_back_at: new Date() },
        completed('second', 'b'),
      ]).status,
    ).toBe('pass');
  });

  const healthy: OperationsSnapshot = {
    utf8: true,
    utc: true,
    workerRecent: true,
    oldQueuedJobs: 0,
    oldRunningJobs: 0,
    failedJobs: 0,
    oldPendingNotices: 0,
    uncertainNotices: 0,
  };
  it('reports missed worker deadlines and queued notices', () => {
    const checks = operationsReadiness({
      ...healthy,
      workerRecent: false,
      oldPendingNotices: 2,
      uncertainNotices: 1,
    });
    expect(checks.filter((check) => check.status === 'fail').map((check) => check.name)).toEqual([
      'worker_dispatch',
      'email_outbox',
    ]);
    expect(
      operationsReadiness({ ...healthy, failedJobs: 2, uncertainNotices: 1 })
        .filter((check) => check.status === 'warn')
        .map((check) => check.name),
    ).toEqual(['provider_queue', 'email_outbox']);
  });
  it('returns structured failure without exposing a malformed connection value or provider secret', () => {
    const secret = 'synthetic-credential-do-not-print';
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)),
        fileURLToPath(new URL('../scripts/check-readiness.ts', import.meta.url)),
      ],
      {
        env: { ...process.env, DATABASE_URL: `http://[${secret}`, AUTH_SECRET: secret },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'requires_attention' });
  });
});
