import { z } from 'zod';
import { reviewNotification } from '@/lib/admin-notification-operations';
import { AppError, assertOrigin, readJson } from '@/lib/security';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    return Response.json(await reviewNotification(await readJson(request, 4096)), { headers });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : status === 400
              ? 'Invalid review.'
              : 'Unable to record review.',
      },
      { status, headers },
    );
  }
}
