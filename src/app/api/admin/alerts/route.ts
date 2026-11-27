import { z } from 'zod';
import {
  unreadSuspiciousActivity,
  updateSuspiciousActivity,
} from '@/lib/admin-suspicious-activity';
import { AppError, assertOrigin, readJson } from '@/lib/security';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try {
    return Response.json({ unread: await unreadSuspiciousActivity() }, { headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 503;
    return Response.json(
      { error: status === 404 ? 'Not found' : 'Alerts unavailable.' },
      { status, headers },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    return Response.json(await updateSuspiciousActivity(await readJson(request, 4096)), {
      headers,
    });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : status === 400
              ? 'Invalid alert action.'
              : 'Unable to update alert.',
      },
      { status, headers },
    );
  }
}
