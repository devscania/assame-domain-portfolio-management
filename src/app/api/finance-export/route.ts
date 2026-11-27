import Decimal from 'decimal.js';
import { context } from '@/lib/access';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { financials } from '@/lib/domain';
import { csvStream, requireExportMembership } from '@/lib/csv-stream';

export const runtime = 'nodejs';
export async function GET() {
  try {
    const ctx = await context();
    const session = await auth();
    const sessionId = (session as typeof session & { loginSessionId?: string })?.loginSessionId;
    if (!ctx.user.id || session?.user?.id !== ctx.user.id || !sessionId)
      throw new Error('Sign in required');
    let cursor: string | undefined;
    const stream = csvStream(
      'domain,marketplace,currency,agreementAmount,collected,commissionWithheld,grossSettled,unpaid,commission,netProceeds,realizedProfit,status,type,soldAt,source',
      async () => {
        await requireExportMembership(ctx.org.id, ctx.user.id!, sessionId);
        const sales = await db.domainSale.findMany({
          where: { domain: { organizationId: ctx.org.id }, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: {
            id: true,
            domainId: true,
            marketplace: true,
            currency: true,
            grossAmount: true,
            status: true,
            kind: true,
            soldAt: true,
            source: true,
            domain: { select: { name: true, acquisitionCost: true } },
          },
          orderBy: { id: 'asc' },
          take: 500,
        });
        if (!sales.length) return [];
        cursor = sales[sales.length - 1].id;
        const saleIds = sales.map((sale) => sale.id);
        const domainIds = [...new Set(sales.map((sale) => sale.domainId))];
        const [payments, commissions, adjustments, expenses] = await Promise.all([
          db.salePayment.groupBy({
            by: ['saleId'],
            where: { saleId: { in: saleIds } },
            _sum: { amount: true, commissionWithheld: true },
          }),
          db.commission.groupBy({
            by: ['saleId'],
            where: { saleId: { in: saleIds } },
            _sum: { amount: true },
          }),
          db.financialAdjustment.groupBy({
            by: ['saleId'],
            where: { saleId: { in: saleIds } },
            _sum: { amount: true },
          }),
          db.domainExpense.groupBy({
            by: ['domainId', 'currency'],
            where: { domainId: { in: domainIds } },
            _sum: { amount: true },
          }),
        ]);
        const paymentBySale = new Map(payments.map((row) => [row.saleId, row._sum]));
        const commissionBySale = new Map(commissions.map((row) => [row.saleId, row._sum.amount]));
        const adjustmentBySale = new Map(adjustments.map((row) => [row.saleId, row._sum.amount]));
        const expenseByDomain = new Map(
          expenses.map((row) => [`${row.domainId}:${row.currency}`, row._sum.amount]),
        );
        return sales.map((sale) => {
          const payment = paymentBySale.get(sale.id);
          const collected = new Decimal(payment?.amount?.toString() ?? '0');
          const withheld = new Decimal(payment?.commissionWithheld?.toString() ?? '0');
          const commission = new Decimal(commissionBySale.get(sale.id)?.toString() ?? '0');
          const adjustment = new Decimal(adjustmentBySale.get(sale.id)?.toString() ?? '0');
          const expense = new Decimal(
            expenseByDomain.get(`${sale.domainId}:${sale.currency}`)?.toString() ?? '0',
          );
          const investment = new Decimal(sale.domain.acquisitionCost.toString()).plus(expense);
          const result = financials(
            sale.grossAmount.toString(),
            [collected.toString()],
            [commission.toString()],
            investment.toString(),
            sale.status === 'completed',
            [withheld.toString()],
          );
          return [
            sale.domain.name,
            sale.marketplace,
            sale.currency,
            sale.grossAmount.toString(),
            collected.toFixed(2),
            withheld.toFixed(2),
            collected.plus(withheld).toFixed(2),
            result.unpaid,
            commission.toFixed(2),
            sale.status === 'completed' ? result.net : '',
            sale.status === 'completed'
              ? new Decimal(result.realizedProfit).plus(adjustment).toFixed(2)
              : '',
            sale.status,
            sale.kind,
            sale.soldAt.toISOString(),
            sale.source,
          ];
        });
      },
    );
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="assame-finance.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Sign in required' }, { status: 401 });
  }
}
