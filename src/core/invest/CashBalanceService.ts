import type { CoCeoDataGateway, UserContext } from '../dal';

export type CashSnapshot = {
  settledCash: number;
  inTransit: number;
  cashWithTransit: number;
};

type FinancialLedgerBalanceRow = {
  transaction_date?: string | Date | null;
  settlement_date?: string | Date | null;
  direction?: 'in' | 'out' | string | null;
  amount?: number | string | null;
  status?: 'pending' | 'cleared' | 'cancelled' | string | null;
};

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export class CashBalanceService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async getSnapshot(
    ctx: UserContext,
    accountId: string,
    asOfDate: string
  ): Promise<CashSnapshot> {
    const legs = (await this.gateway.findWhere(ctx, 'financial_ledger_entries', {
      account_id: accountId,
    })) as FinancialLedgerBalanceRow[];

    let settledCash = 0;
    let inTransit = 0;

    for (const leg of legs) {
      if (String(leg.status ?? 'cleared') === 'cancelled') continue;
      const transactionDate = toIsoDate(leg.transaction_date);
      if (!transactionDate || transactionDate > asOfDate) continue;

      const sign = String(leg.direction) === 'out' ? -1 : 1;
      const amount = Number(leg.amount ?? 0) * sign;
      const status = String(leg.status ?? 'cleared');
      const settlementDate = toIsoDate(leg.settlement_date);

      if (status === 'cleared') {
        settledCash += amount;
      } else if (status === 'pending' && settlementDate > asOfDate) {
        inTransit += amount;
      }
    }

    return {
      settledCash: roundMoney(settledCash),
      inTransit: roundMoney(inTransit),
      cashWithTransit: roundMoney(settledCash + inTransit),
    };
  }
}
