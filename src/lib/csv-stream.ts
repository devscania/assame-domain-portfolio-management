import Papa from 'papaparse';
import { db } from './db';
import { AppError } from './security';

/** Recheck membership between pages of a long-running download. */
export async function requireExportMembership(
  organizationId: string,
  userId: string,
  sessionId: string,
) {
  const [member, session] = await Promise.all([
    db.organizationMember.findFirst({
      where: { organizationId, userId, user: { deletedAt: null } },
      select: { userId: true },
    }),
    db.accountLoginSession.findFirst({
      where: { id: sessionId, userId, expiresAt: { gt: new Date() }, user: { deletedAt: null } },
      select: { sessionVersion: true, user: { select: { sessionVersion: true } } },
    }),
  ]);
  if (!member || !session || session.sessionVersion !== session.user.sessionVersion)
    throw new AppError('Workspace or session access changed during export.', 403);
}

/** Read one page at a time, honoring stream backpressure and client cancellation. */
export function csvStream(header: string, nextPage: () => Promise<unknown[][]>) {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${header}\r\n`));
    },
    async pull(controller) {
      try {
        const rows = await nextPage();
        if (cancelled) return;
        if (!rows.length) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(Papa.unparse(rows, { header: false, escapeFormulae: true }) + '\r\n'),
        );
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
