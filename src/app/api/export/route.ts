import { context } from '@/lib/access';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { comparisonExportPage } from '@/lib/comparison';
import { csvStream, requireExportMembership } from '@/lib/csv-stream';
import { domainWhere } from '@/lib/portfolio';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const session = await auth();
    const sessionId = (session as typeof session & { loginSessionId?: string })?.loginSessionId;
    if (!ctx.user.id || session?.user?.id !== ctx.user.id || !sessionId)
      throw new Error('Sign in required');
    const query = new URL(request.url).searchParams;
    const where = domainWhere(ctx, query);
    const select = {
      id: true,
      name: true,
      currency: true,
      acquisitionCost: true,
      askingPrice: true,
      registrations: { take: 1, select: { registrar: true, expiresAt: true, renewalCost: true } },
      tags: { select: { tag: { select: { name: true } } } },
    } as const;
    let cursor: string | undefined;
    const matrix =
      query.get('matrix') === 'true' ||
      Boolean(query.get('comparison')) ||
      query.get('attention') === 'price-mismatch';
    const stream = csvStream(
      'domain,currency,acquisitionCost,askingPrice,registrar,expiresAt,renewalCost,tags',
      async () => {
        await requireExportMembership(ctx.org.id, ctx.user.id!, sessionId);
        let rows;
        if (matrix) {
          // An entire page can disappear between selection and hydration; keep
          // advancing instead of ending the download prematurely.
          do {
            await requireExportMembership(ctx.org.id, ctx.user.id!, sessionId);
            const result = await comparisonExportPage(ctx, query, cursor, 500);
            if (!result.rows.length) return [];
            cursor = result.rows[result.rows.length - 1].id;
            rows = await db.domain.findMany({
              where: { ...where, id: { in: result.rows.map((row) => row.id) } },
              select,
              orderBy: { id: 'asc' },
            });
          } while (!rows.length);
        } else {
          rows = await db.domain.findMany({
            where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
            select,
            orderBy: { id: 'asc' },
            take: 1000,
          });
          if (rows.length) cursor = rows[rows.length - 1].id;
        }
        return rows.map((d) => [
          d.name,
          d.currency,
          d.acquisitionCost.toString(),
          d.askingPrice?.toString() ?? '',
          d.registrations[0]?.registrar ?? '',
          d.registrations[0]?.expiresAt?.toISOString().slice(0, 10) ?? '',
          d.registrations[0]?.renewalCost?.toString() ?? '',
          d.tags.map((t) => t.tag.name).join(';'),
        ]);
      },
    );
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="assame-portfolio.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Sign in required' }, { status: 401 });
  }
}
