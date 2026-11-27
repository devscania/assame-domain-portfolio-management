import Decimal from 'decimal.js';
const sum = (values: string[]) => values.reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2);
export function financials(
  gross: string,
  payments: string[],
  commissions: string[],
  investment: string,
  completed: boolean,
  withheld: string[] = [],
) {
  const collected = new Decimal(sum(payments));
  const feesWithheld = new Decimal(sum(withheld));
  const settled = collected.plus(feesWithheld);
  const net = collected.minus(Decimal.max(0, new Decimal(sum(commissions)).minus(feesWithheld)));
  return {
    collected: collected.toFixed(2),
    unpaid: Decimal.max(0, new Decimal(gross).minus(settled)).toFixed(2),
    net: net.toFixed(2),
    realizedProfit: completed && settled.gte(gross) ? net.minus(investment).toFixed(2) : '0.00',
  };
}
