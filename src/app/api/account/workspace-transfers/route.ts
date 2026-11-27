import { z } from 'zod';
import { auth } from '@/auth';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { requestWorkspaceTransfer, resolveWorkspaceTransfer } from '@/lib/workspace-transfers';

export const runtime = 'nodejs';
const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request'),
    organizationId: z.string().min(1).max(100),
    email: z.string().email().max(254),
    confirmation: z.string().min(1).max(200),
  }),
  z.object({
    action: z.enum(['accept', 'decline', 'cancel']),
    transferId: z.string().min(1).max(100),
  }),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const input = inputSchema.parse(await readJson(request, 4096));
    await throttle(`workspace-transfer:${session.user.id}`, 30);
    if (input.action === 'request')
      await requestWorkspaceTransfer(
        session.user.id,
        input.organizationId,
        input.email,
        input.confirmation,
      );
    else await resolveWorkspaceTransfer(session.user.id, input.transferId, input.action);
    return Response.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Unable to complete transfer. Please try again.',
      },
      { status },
    );
  }
}
