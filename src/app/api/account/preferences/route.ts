import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AppError, assertOrigin, readJson } from '@/lib/security';
import { emailConfigured } from '@/lib/auth-email';
import { defaultActivityEmailPreferences } from '@/lib/activity-email-policy';

const schema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    notifications: z.boolean().optional(),
    renewalEmails: z.boolean().optional(),
    activityEmails: z.boolean().optional(),
    activityBulkEmails: z.boolean().optional(),
    activityPriceEmails: z.boolean().optional(),
    activitySyncEmails: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.theme !== undefined ||
      data.notifications !== undefined ||
      data.renewalEmails !== undefined ||
      data.activityEmails !== undefined ||
      data.activityBulkEmails !== undefined ||
      data.activityPriceEmails !== undefined ||
      data.activitySyncEmails !== undefined,
  );
const headers = { 'Cache-Control': 'private, no-store' };
const preferenceFields = {
  theme: true,
  notifications: true,
  renewalEmails: true,
  activityEmails: true,
  activityBulkEmails: true,
  activityPriceEmails: true,
  activitySyncEmails: true,
} as const;
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const preference = await db.userPreference.findUnique({
      where: { userId: session.user.id },
      select: preferenceFields,
    });
    const theme = z.enum(['light', 'dark', 'system']).safeParse(preference?.theme);
    return Response.json(
      {
        theme: theme.success ? theme.data : null,
        notifications: preference?.notifications ?? true,
        renewalEmails: preference?.renewalEmails ?? false,
        activityEmails: preference?.activityEmails ?? false,
        activityBulkEmails:
          preference?.activityBulkEmails ?? defaultActivityEmailPreferences.activityBulkEmails,
        activityPriceEmails:
          preference?.activityPriceEmails ?? defaultActivityEmailPreferences.activityPriceEmails,
        activitySyncEmails:
          preference?.activitySyncEmails ?? defaultActivityEmailPreferences.activitySyncEmails,
        activityEmailsAvailable: emailConfigured(),
        renewalEmailsAvailable:
          process.env.RENEWAL_REMINDERS_ENABLED === 'true' && emailConfigured(),
      },
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof AppError ? error.message : 'Unable to load preferences' },
      { status: error instanceof AppError ? error.status : 503, headers },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new AppError('Sign in required', 401);
    const input = schema.parse(await readJson(request, 4096));
    if (
      input.renewalEmails &&
      (process.env.RENEWAL_REMINDERS_ENABLED !== 'true' || !emailConfigured())
    )
      throw new AppError('Renewal email reminders are not configured.', 409);
    if (input.activityEmails && !emailConfigured())
      throw new AppError('Activity emails are not configured.', 409);
    const userId = session.user.id;
    const preference = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
      if (!user || user.deletedAt) throw new AppError('Sign in required', 401);
      return tx.userPreference.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
        select: preferenceFields,
      });
    });
    return Response.json(preference, { headers });
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json(
      { error: error instanceof AppError ? error.message : 'Unable to save preferences' },
      { status, headers },
    );
  }
}
