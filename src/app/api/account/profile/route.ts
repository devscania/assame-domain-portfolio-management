import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';

export const runtime = 'nodejs';
const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/\p{Cc}/u.test(value)),
  })
  .strict();
const headers = { 'Cache-Control': 'private, no-store' };
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const { name } = schema.parse(await readJson(request, 4096));
    await throttle(`profile-update:${session.user.id}`, 30);
    const user = await db.user.update({
      where: { id: session.user.id, deletedAt: null },
      data: { name },
      select: { name: true },
    });
    return Response.json(user, { headers });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : error instanceof z.ZodError
              ? 'Enter a valid name of up to 100 characters.'
              : 'Unable to update your profile.',
      },
      { status, headers },
    );
  }
}
