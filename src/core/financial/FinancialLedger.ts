import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { GatewayError } from '../dal/errors';
import type {
  FinancialLedgerRow,
  RecordCashMovementInput,
  LedgerDirection,
} from './types';
import type { SettlementEngine } from './SettlementEngine';

/**
 * Livro razao financeiro canonico. Append-only com soft delete pelo gateway.
 *
 * Saldo de uma conta = opening_balance + SUM(in) - SUM(out) com filtro de
 * status='cleared' OU 'pending' conforme a visao desejada.
 */
export class FinancialLedger {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly settlementEngine: SettlementEngine
  ) {}

  async record(
    ctx: UserContext,
    input: RecordCashMovementInput,
    options: { allowZeroAmount?: boolean } = {}
  ): Promise<FinancialLedgerRow> {
    if (!input.businessEventId) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        'Lancamento financeiro sem business_event_id. Toda alteracao de caixa precisa de um evento de negocio.',
        422
      );
    }

    if (input.amount < 0 || (input.amount === 0 && !options.allowZeroAmount)) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        `amount deve ser positivo (ou zero com allowZeroAmount); sinal eh dado pela direction (in/out). Recebido: ${input.amount}`,
        400
      );
    }

    let settlementDate = input.settlementDate;
    if (!settlementDate) {
      const profile = input.settlementProfileCode ?? 'INSTANT';
      settlementDate = await this.settlementEngine.resolveSettlementDate(
        ctx,
        input.transactionDate,
        profile
      );
    }

    const id = randomUUID();
    const payload: SecurePayload = {
      id,
      account_id: input.accountId,
      transaction_date: input.transactionDate,
      settlement_date: settlementDate,
      direction: input.direction,
      amount: input.amount,
      currency: input.currency ?? 'BRL',
      description: input.description ?? null,
      counterparty: input.counterparty ?? null,
      status: input.status ?? 'pending',
      related_patrimony_ledger_id: input.relatedPatrimonyLedgerId ?? null,
      business_event_id: input.businessEventId,
      source_batch_id: input.sourceBatchId ?? null,
      external_ref: input.externalRef ?? null,
      metadata: input.metadata == null
        ? null
        : typeof input.metadata === 'string'
        ? input.metadata
        : JSON.stringify(input.metadata),
    };
    await this.gateway.insert(ctx, 'financial_ledger_entries', payload);
    const row = (await this.gateway.findById(
      ctx,
      'financial_ledger_entries',
      id
    )) as FinancialLedgerRow | null;
    if (!row) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `Falha ao criar financial_ledger_entries ${id}`,
        500
      );
    }
    return row;
  }

  /** Linkar perna financeira a perna patrimonial apos as duas existirem. */
  async linkToPatrimonyLedger(
    ctx: UserContext,
    financialLedgerId: string,
    patrimonyLedgerId: string
  ): Promise<void> {
    await this.gateway.update(ctx, 'financial_ledger_entries', financialLedgerId, {
      related_patrimony_ledger_id: patrimonyLedgerId,
    });
  }

  async computeBalance(
    ctx: UserContext,
    accountId: string,
    options: { includePending?: boolean } = {}
  ): Promise<number> {
    const account = (await this.gateway.findById(ctx, 'financial_accounts', accountId)) as
      | { opening_balance: number | string }
      | null;
    if (!account) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `financial_accounts ${accountId} nao encontrada`,
        404
      );
    }

    const filters: SecurePayload = { account_id: accountId };
    const rows = (await this.gateway.findWhere(
      ctx,
      'financial_ledger_entries',
      filters
    )) as FinancialLedgerRow[];

    const hasOpeningLedger = rows.some((r) => {
      const rawMeta = r.metadata;
      let meta: Record<string, unknown> = {};
      if (rawMeta && typeof rawMeta === 'object') meta = rawMeta as Record<string, unknown>;
      else if (typeof rawMeta === 'string') {
        try {
          meta = JSON.parse(rawMeta) as Record<string, unknown>;
        } catch {
          meta = {};
        }
      }
      return (
        meta.legacy_op === 'opening_balance' ||
        /saldo\s+inicial/i.test(String(r.description || ''))
      );
    });
    let balance = hasOpeningLedger ? 0 : Number(account.opening_balance);
    for (const r of rows) {
      if (r.status === 'cancelled') continue;
      if (r.status === 'pending' && !options.includePending) continue;
      const signed = r.direction === 'in' ? Number(r.amount) : -Number(r.amount);
      balance += signed;
    }
    return balance;
  }
}
