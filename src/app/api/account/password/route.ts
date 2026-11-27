import { z } from 'zod';
import { auth } from '@/auth';
import { changeAccountPassword } from '@/lib/account-security';
import { AppError, assertOrigin, readJson } from '@/lib/security';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        password: z.string().min(12).max(128),
        confirmPassword: z.string().min(12).max(128),
      })
      .parse(await readJson(request, 4096));
    if (input.password !== input.confirmPassword) throw new AppError('Passwords do not match');
    await changeAccountPassword(
      session.user.id,
      input.currentPassword,
      input.password,
      request.headers.get('x-forwarded-for')?.split(',')[0] || 'local',
    );
    return Response.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : 'Unable to change password. Please try again.',
      },
      { status },
    );
  }
}
