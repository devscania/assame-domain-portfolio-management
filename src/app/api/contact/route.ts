import { z } from 'zod';
import { db } from '@/lib/db';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { throttle } from '@/lib/throttle';
import { contactKinds } from '@/lib/contact-kind';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        message: z.string().trim().min(10).max(5000),
        kind: z.enum(contactKinds).default('contact'),
      })
      .parse(await readJson(request, 12000));
    await throttle(
      `contact-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      10,
      3600,
    );
    await throttle(`contact-email:${input.email}`, 5, 3600);
    await db.contactRequest.create({ data: input });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      {
        error:
          status === 429
            ? 'Too many requests. Please try again later.'
            : status === 400
              ? 'Check your details and try again.'
              : 'Unable to send your request. Please try again later.',
      },
      { status },
    );
  }
}
