import { randomUUID } from 'node:crypto';
import type { Context } from './access';
import { db } from './db';
import { fillPublicRegistrations } from './public-registration';
import { requireRole } from './permissions';
import { AppError } from './security';
import { lockWritableWorkspace } from './workspace-write';

type Job = {
  organizationId: string;
  requestedBy: string;
  cursor: string;
};

export async function publicRegistrationStatus(organizationId: string) {
  const [job] = await db.$queryRaw<
    {
      status: 'queued' | 'running' | 'completed' | 'failed';
      updated: number;
      unchanged: number;
      unavailable: number;
      error: string | null;
    }[]
  >`SELECT status, updated, unchanged, unavailable, error FROM "PublicRegistrationJob" WHERE "organizationId"=${organizationId}`;
  return job ?? null;
}

export async function queuePublicRegistration(ctx: Context) {
  requireRole(ctx);
  if (ctx.org.demo)
    throw new AppError('Public registration lookup is unavailable in the demo workspace.', 409);
  return db.$transaction(async (tx) => {
    await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
    const queued = await tx.$executeRaw`
      INSERT INTO "PublicRegistrationJob" ("organizationId", "requestedBy")
      VALUES (${ctx.org.id}, ${ctx.user.id!})
      ON CONFLICT ("organizationId") DO UPDATE SET "requestedBy"=EXCLUDED."requestedBy",
        status='queued', cursor='', updated=0, unchanged=0, unavailable=0,
        "createdAt"=CURRENT_TIMESTAMP, "leaseUntil"=NULL, "leaseToken"=NULL, "finishedAt"=NULL, error=NULL
      WHERE "PublicRegistrationJob".status IN ('completed', 'failed')
    `;
    return { queued: queued > 0 };
  });
}

export async function publicRegistrationsForDispatch() {
  return db.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "PublicRegistrationJob"
    WHERE status='queued' OR (status='running' AND "leaseUntil" < CURRENT_TIMESTAMP)
    ORDER BY "createdAt" LIMIT 100
  `;
}

const batchSize = 20;

export async function runPublicRegistration(organizationId: string) {
  const token = randomUUID();
  const [job] = await db.$queryRaw<Job[]>`
    UPDATE "PublicRegistrationJob" SET status='running', "leaseToken"=${token},
      "leaseUntil"=CURRENT_TIMESTAMP + interval '2 minutes'
    WHERE "organizationId"=${organizationId} AND
      (status='queued' OR (status='running' AND "leaseUntil" < CURRENT_TIMESTAMP))
    RETURNING "organizationId", "requestedBy", cursor
  `;
  if (!job) return;
  try {
    const member = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: job.requestedBy } },
      include: { organization: true },
    });
    if (!member || member.organization.demo) throw new AppError('Workspace access changed.', 403);
    const ctx: Context = {
      org: member.organization,
      role: member.role,
      user: { id: job.requestedBy },
      members: [member],
    };
    await db.$transaction(async (tx) => {
      await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
    });
    const domains = await db.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM "Domain" d
      WHERE d."organizationId"=${organizationId} AND d."deletedAt" IS NULL AND d.id>${job.cursor}
        AND (NOT EXISTS (
          SELECT 1 FROM "DomainRegistration" r WHERE r."domainId"=d.id
          AND r."expiresAt" IS NOT NULL AND lower(btrim(r.registrar)) NOT IN ('', 'unknown')
        ) OR NOT EXISTS (
          SELECT 1 FROM "DomainRegistration" r WHERE r."domainId"=d.id AND cardinality(r.nameservers)>0
        ))
      ORDER BY d.id LIMIT ${batchSize}
    `;
    const result = await fillPublicRegistrations(
      ctx,
      domains.map(({ id }) => id),
      async (tx) => {
        const lease = await tx.$queryRaw<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "PublicRegistrationJob"
        WHERE "organizationId"=${organizationId} AND "leaseToken"=${token}
          AND "leaseUntil" > CURRENT_TIMESTAMP FOR UPDATE
      `;
        if (!lease.length) throw new AppError('Lookup lease expired.', 409);
      },
    );
    const finished = domains.length < batchSize;
    await db.$executeRaw`
      UPDATE "PublicRegistrationJob" SET status=${finished ? 'completed' : 'queued'},
        cursor=${domains.at(-1)?.id ?? job.cursor}, updated=updated+${result.updated},
        unchanged=unchanged+${result.unchanged}, unavailable=unavailable+${result.unavailable},
        "leaseUntil"=NULL, "leaseToken"=NULL, "finishedAt"=${finished ? new Date() : null}
      WHERE "organizationId"=${organizationId} AND "leaseToken"=${token}
    `;
  } catch (error) {
    const message =
      error instanceof AppError && error.status === 403
        ? 'Workspace permissions changed. Start a new lookup after restoring access.'
        : 'The lookup could not finish. Start a new lookup to retry missing details.';
    await db.$executeRaw`
      UPDATE "PublicRegistrationJob" SET status='failed', error=${message},
        "leaseUntil"=NULL, "leaseToken"=NULL, "finishedAt"=CURRENT_TIMESTAMP
      WHERE "organizationId"=${organizationId} AND "leaseToken"=${token}
    `;
  }
}
