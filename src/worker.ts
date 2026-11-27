import { lockWorkspaceOwner } from './lib/workspace-owner';
import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { db } from './lib/db';
import {
  publicRegistrationsForDispatch,
  runPublicRegistration,
} from './lib/public-registration-jobs';
import { runSync } from './integrations/sync';
import { runListingPriceJob } from './lib/listing-prices';
import { runProviderChange } from './lib/provider-changes';
import { runListingStats } from './integrations/listing-stats';
import { logger, AppError } from './lib/security';
import { scheduleRenewalReminders, sendOneRenewalReminder } from './lib/renewal-reminders';
import { sendOneWelcomeNotice } from './lib/welcome-notices';
import { cleanupExpiredAuthentication } from './lib/auth-expiration-cleanup';
import { validateRuntimeConfig } from './lib/runtime-config';
import { recordWorkerDispatch } from './lib/worker-health';
import { scheduledProviderPage } from './lib/scheduled-providers';
import { providerJobsForDispatch } from './lib/provider-priority';
import { sendOneSecurityNotice } from './lib/security-notices';
import { sendOneActivityNotice } from './lib/activity-notices';
import { refreshPendingAfternicListings } from './lib/pending-marketplace-listings';
import { createWorkerShutdown } from './lib/worker-shutdown';
validateRuntimeConfig(process.env);
let stopping = false;
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  application_name: 'domain-console-worker',
});
boss.on('error', () => logger.error('Queue error; check database connectivity'));
await boss.start();
await boss.createQueue('provider-sync', {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 7200,
});
const providerTasks = new Set<Promise<void>>();
await boss.work<{ jobId: string }>('provider-sync', { batchSize: 1 }, async (jobs) => {
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => {
    finished = resolve;
  });
  providerTasks.add(completion);
  try {
    for (const job of jobs) {
      try {
        const record = await db.syncJob.findUnique({
          where: { id: job.data.jobId },
          select: { kind: true },
        });
        if (record?.kind === 'price') await runListingPriceJob(job.data.jobId);
        else if (record?.kind === 'providerChange') await runProviderChange(job.data.jobId);
        else if (record?.kind === 'statistics') await runListingStats(job.data.jobId);
        else await runSync(job.data.jobId);
      } catch (error) {
        if (error instanceof AppError && [400, 403, 409, 429].includes(error.status)) {
          logger.warn(
            { jobId: job.data.jobId },
            'Synchronization needs user action; automatic retry skipped',
          );
          continue;
        }
        throw error;
      }
    }
  } finally {
    providerTasks.delete(completion);
    finished();
  }
});
await boss.createQueue('public-registration', { expireInSeconds: 180 });
await boss.work<{ organizationId: string }>(
  'public-registration',
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs) {
      const task = runPublicRegistration(job.data.organizationId);
      providerTasks.add(task);
      try {
        await task;
      } finally {
        providerTasks.delete(task);
      }
    }
  },
);
let scheduledAfter: string | undefined;
async function dispatch() {
  // Recover interrupted jobs even if scheduling later in this dispatch fails.
  // Executing mutations use read-back recovery and never replay their write.
  const now = new Date();
  await db.syncJob.updateMany({
    where: {
      status: 'running',
      account: {
        OR: [{ lockedUntil: { lte: now } }, { lockedUntil: null }],
      },
      startedAt: { lte: new Date(now.getTime() - 600000) },
    },
    data: { status: 'queued' },
  });
  // The database job table is the outbox: queue downtime cannot lose an accepted request.
  for (const job of await publicRegistrationsForDispatch()) {
    if (stopping) break;
    await boss.send('public-registration', job, {
      singletonKey: job.organizationId,
      singletonSeconds: 10,
    });
  }
  const pending = await providerJobsForDispatch();
  for (const job of pending) {
    if (stopping) break;
    await boss.send(
      'provider-sync',
      { jobId: job.id },
      { singletonKey: job.id, singletonSeconds: 60, priority: job.priority },
    );
  }
  if (stopping) return;
  const scheduled = await scheduledProviderPage(scheduledAfter);
  for (const account of scheduled.accounts) {
    if (stopping) break;
    if (
      account.lastSyncAt &&
      Date.now() - account.lastSyncAt.getTime() < account.syncEveryHours * 3600000
    )
      continue;
    try {
      await db.$transaction(async (tx) => {
        await lockWorkspaceOwner(tx, account.organizationId);
        await tx.$queryRaw`SELECT id FROM "ProviderAccount" WHERE id=${account.id} FOR UPDATE`;
        const recent = await tx.syncJob.findFirst({
          where: { providerAccountId: account.id },
          orderBy: { createdAt: 'desc' },
        });
        if (
          recent &&
          (['queued', 'running'].includes(recent.status) ||
            Date.now() - recent.createdAt.getTime() < account.syncEveryHours * 3600000)
        )
          return;
        await tx.syncJob.create({ data: { providerAccountId: account.id } });
      });
    } catch (error) {
      if (!(error instanceof AppError && [403, 409, 429].includes(error.status))) throw error;
    }
  }
  // Resume after this bounded page; a short page ends the cycle. A restart begins
  // a fresh scan, while the ID comparison also tolerates deleted cursor rows.
  if (stopping) return;
  scheduledAfter = scheduled.next;
  await recordWorkerDispatch();
}
let dispatchTask: Promise<void> | undefined;
let dispatchBusy = false;
function triggerDispatch() {
  if (stopping || dispatchBusy) return;
  dispatchBusy = true;
  dispatchTask = dispatch()
    .catch(() => logger.error('Outbox dispatch failed'))
    .finally(() => {
      dispatchBusy = false;
    });
}
triggerDispatch();
const timer = setInterval(triggerDispatch, 15000);
let remindersBusy = false;
async function dispatchRenewalEmails() {
  if (stopping || process.env.RENEWAL_REMINDERS_ENABLED !== 'true' || remindersBusy) return;
  remindersBusy = true;
  try {
    await scheduleRenewalReminders();
    for (let i = 0; i < 10 && !stopping; i++) if (!(await sendOneRenewalReminder())) break;
  } catch {
    logger.error('Renewal reminder dispatch failed');
  } finally {
    remindersBusy = false;
  }
}
let renewalTask: Promise<void> | undefined;
function triggerRenewalEmails() {
  if (!stopping && !remindersBusy) renewalTask = dispatchRenewalEmails();
}
triggerRenewalEmails();
const renewalTimer = setInterval(() => {
  triggerRenewalEmails();
}, 60000);
let welcomeNoticeTask: Promise<void> | undefined;
let welcomeNoticeBusy = false;
function triggerWelcomeNotices() {
  if (stopping || welcomeNoticeBusy || process.env.WELCOME_EMAILS_ENABLED !== 'true') return;
  welcomeNoticeBusy = true;
  welcomeNoticeTask = (async () => {
    try {
      for (let i = 0; i < 10 && !stopping; i++) if (!(await sendOneWelcomeNotice())) break;
    } catch {
      logger.error('Welcome email dispatch failed');
    } finally {
      welcomeNoticeBusy = false;
    }
  })();
}
triggerWelcomeNotices();
const welcomeNoticeTimer = setInterval(triggerWelcomeNotices, 60000);
let securityNoticeTask: Promise<void> | undefined;
let securityNoticeBusy = false;
function triggerSecurityNotices() {
  if (stopping || securityNoticeBusy) return;
  securityNoticeBusy = true;
  securityNoticeTask = (async () => {
    try {
      for (let i = 0; i < 10 && !stopping; i++) if (!(await sendOneSecurityNotice())) break;
    } catch {
      logger.error('Security notice dispatch failed');
    } finally {
      securityNoticeBusy = false;
    }
  })();
}
triggerSecurityNotices();
const securityNoticeTimer = setInterval(triggerSecurityNotices, 60000);
let activityNoticeTask: Promise<void> | undefined;
function triggerActivityNotices() {
  if (stopping || activityNoticeTask) return;
  activityNoticeTask = (async () => {
    try {
      for (let i = 0; i < 10 && !stopping; i++) if (!(await sendOneActivityNotice())) break;
    } catch {
      logger.error('Workspace activity email processing failed');
    } finally {
      activityNoticeTask = undefined;
    }
  })();
}
triggerActivityNotices();
const activityNoticeTimer = setInterval(triggerActivityNotices, 15000);
let pendingListingsTask: Promise<void> | undefined;
function triggerPendingListings() {
  if (stopping || pendingListingsTask) return;
  pendingListingsTask = refreshPendingAfternicListings()
    .catch(() => logger.error('Pending marketplace listing refresh failed'))
    .finally(() => {
      pendingListingsTask = undefined;
    });
}
triggerPendingListings();
const pendingListingsTimer = setInterval(triggerPendingListings, 60000);
let cleanupTask: Promise<void> | undefined;
let cleanupBusy = false;
function triggerAuthCleanup() {
  if (stopping || cleanupBusy) return;
  cleanupBusy = true;
  cleanupTask = cleanupExpiredAuthentication()
    .then(() => undefined)
    .catch(() => logger.error('Expired authentication cleanup failed'))
    .finally(() => {
      cleanupBusy = false;
    });
}
triggerAuthCleanup();
const cleanupTimer = setInterval(triggerAuthCleanup, 15 * 60000);
logger.info(
  'Worker ready. Sync and statistics are read-only; provider writes require confirmed jobs and workspace opt-in.',
);
const shutdown = createWorkerShutdown({
  stopScheduling: () => {
    stopping = true;
    for (const activeTimer of [
      timer,
      renewalTimer,
      welcomeNoticeTimer,
      securityNoticeTimer,
      activityNoticeTimer,
      pendingListingsTimer,
      cleanupTimer,
    ])
      clearInterval(activeTimer);
  },
  dispatch: () => dispatchTask,
  stopQueue: () => boss.stop({ graceful: true, timeout: 120000 }),
  background: () => [
    renewalTask,
    welcomeNoticeTask,
    securityNoticeTask,
    activityNoticeTask,
    pendingListingsTask,
    cleanupTask,
    // pg-boss can finish its grace timeout while a handler still runs. Keep
    // Prisma available until the actual accepted callback has finished too.
    ...providerTasks,
  ],
  disconnect: () => db.$disconnect(),
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void shutdown()
      .then(() => process.exit(0))
      .catch(() => {
        logger.error('Worker shutdown did not complete cleanly');
        process.exit(1);
      });
  });
