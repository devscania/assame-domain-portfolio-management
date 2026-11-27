export type ReadinessCheck = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

export type MigrationRecord = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/** Compare deployment artifacts with the database ledger without changing either. */
export function migrationReadiness(
  expected: { name: string; checksum: string }[],
  recorded: MigrationRecord[],
): ReadinessCheck {
  const active = recorded.filter((item) => !item.rolled_back_at);
  const incomplete = active.filter((item) => !item.finished_at).length;
  const completed = new Map(
    active.filter((item) => item.finished_at).map((item) => [item.migration_name, item.checksum]),
  );
  const names = new Set(expected.map((item) => item.name));
  const missing = expected.filter((item) => !completed.has(item.name)).length;
  const changed = expected.filter(
    (item) => completed.has(item.name) && completed.get(item.name) !== item.checksum,
  ).length;
  const unknown = [...completed.keys()].filter((name) => !names.has(name)).length;
  return {
    name: 'migrations',
    status: incomplete || missing || changed || unknown ? 'fail' : 'pass',
    detail: `${expected.length} packaged; ${missing} pending; ${incomplete} unfinished; ${changed} checksum mismatches; ${unknown} database-only.`,
  };
}

export type OperationsSnapshot = {
  utf8: boolean;
  utc: boolean;
  workerRecent: boolean;
  oldQueuedJobs: number;
  oldRunningJobs: number;
  failedJobs: number;
  oldPendingNotices: number;
  uncertainNotices: number;
};

/** Only counts and fixed diagnostics are returned; no account/provider records. */
export function operationsReadiness(snapshot: OperationsSnapshot): ReadinessCheck[] {
  const check = (name: string, status: ReadinessCheck['status'], detail: string) => ({
    name,
    status,
    detail,
  });
  return [
    check(
      'database_encoding',
      snapshot.utf8 ? 'pass' : 'fail',
      snapshot.utf8 ? 'UTF8.' : 'UTF8 is required for international names.',
    ),
    check(
      'database_timezone',
      snapshot.utc ? 'pass' : 'fail',
      snapshot.utc ? 'UTC.' : 'UTC reporting connections are required.',
    ),
    check(
      'worker_dispatch',
      snapshot.workerRecent ? 'pass' : 'fail',
      snapshot.workerRecent
        ? 'A dispatch completed within five minutes.'
        : 'No completed dispatch within five minutes.',
    ),
    check(
      'provider_queue',
      snapshot.oldQueuedJobs || snapshot.oldRunningJobs
        ? 'fail'
        : snapshot.failedJobs
          ? 'warn'
          : 'pass',
      `${snapshot.oldQueuedJobs} queued over 15 minutes; ${snapshot.oldRunningJobs} running over two hours; ${snapshot.failedJobs} failures in 24 hours.`,
    ),
    check(
      'email_outbox',
      snapshot.oldPendingNotices ? 'fail' : snapshot.uncertainNotices ? 'warn' : 'pass',
      `${snapshot.oldPendingNotices} pending over 15 minutes; ${snapshot.uncertainNotices} failed, sending, or uncertain. Provider evidence is required before retrying.`,
    ),
  ];
}
