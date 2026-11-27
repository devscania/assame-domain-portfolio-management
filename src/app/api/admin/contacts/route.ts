import { z } from 'zod';
import { contactStatuses, updateContactStatus } from '@/lib/platform-admin';
import { AppError, assertOrigin, readJson } from '@/lib/security';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const schema = z
  .object({
    id: z.string().min(1).max(128),
    expected: z.enum(contactStatuses),
    status: z.enum(contactStatuses),
  })
  .strict();
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const input = schema.parse(await readJson(request, 4096));
    return Response.json(await updateContactStatus(input.id, input.expected, input.status), {
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
              ? 'Invalid status change.'
              : 'Unable to update request status.',
      },
      { status, headers },
    );
  }
}
