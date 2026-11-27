import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AppError, assertOrigin } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { z } from 'zod';
import { readJson } from '@/lib/security';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { sessionVersion: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new AppError('Sign in required', 401);
    const current = (session as typeof session & { loginSessionId?: string }).loginSessionId;
    const rows = await db.accountLoginSession.findMany({
      where: {
        userId: session.user.id,
        sessionVersion: user.sessionVersion,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, method: true, createdAt: true, expiresAt: true },
      take: 100,
    });
    return Response.json(
      { sessions: rows.map((row) => ({ ...row, current: row.id === current })) },
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof AppError ? error.message : 'Unable to load sessions.' },
      { status: error instanceof AppError ? error.status : 503, headers },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await readJson(request, 1024));
    await throttle(`session-revoke:${session.user.id}`, 10);
    const userId = session.user.id;
    const currentId = (session as typeof session & { loginSessionId?: string }).loginSessionId;
    if (!currentId) throw new AppError('Sign in required', 401);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.accountLoginSession.findFirst({
        where: { id: currentId, userId, expiresAt: { gt: new Date() }, user: { deletedAt: null } },
        include: { user: { select: { sessionVersion: true } } },
      });
      if (!current || current.sessionVersion !== current.user.sessionVersion)
        throw new AppError('Sign in required', 401);
      const deleted = await tx.accountLoginSession.deleteMany({ where: { id, userId } });
      if (!deleted.count) throw new AppError('Session not found.', 404);
    });
    return Response.json({ ok: true, current: id === currentId }, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : error instanceof z.ZodError
              ? 'Invalid session.'
              : 'Unable to sign out device.',
      },
      {
        status: error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503,
        headers,
      },
    );
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    await throttle(`session-revoke:${session.user.id}`, 10);
    const userId = session.user.id;
    const currentId = (session as typeof session & { loginSessionId?: string }).loginSessionId;
    if (!currentId) throw new AppError('Sign in required', 401);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.accountLoginSession.findFirst({
        where: { id: currentId, userId, expiresAt: { gt: new Date() }, user: { deletedAt: null } },
        include: { user: { select: { sessionVersion: true } } },
      });
      if (!current || current.sessionVersion !== current.user.sessionVersion)
        throw new AppError('Sign in required', 401);
      const changed = await tx.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: { sessionVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new AppError('Sign in required', 401);
      await tx.accountLoginSession.deleteMany({ where: { userId } });
    });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof AppError ? error.message : 'Unable to sign out devices.' },
      { status: error instanceof AppError ? error.status : 503, headers },
    );
  }
}
