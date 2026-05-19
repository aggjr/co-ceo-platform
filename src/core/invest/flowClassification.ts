import type { LedgerTransactionType } from './ledgerTypes';

/**
 * Fronteira INVEST × CASH (visão de produto):
 *
 * - CASH: contas (no INVEST = contas de investimento), entradas/saídas, aportes,
 *   retiradas, despesas de manutenção, multas, juros de caixa.
 * - INVEST (passivo): proventos sem boleta — dividendos, JCP, locação — podem ser
 *   lançados via CASH (entradas) ou espelhados no livro-razão para o pivot.
 * - INVEST (ativo): compra/venda e opções via notas de corretagem → invest_ledger_entries.
 */

/** Proventos e fluxos de caixa sem operação de mercado (ganhos passivos). */
export const PASSIVE_INCOME_OPERATIONS: readonly LedgerTransactionType[] = [
  'dividend',
  'jcp',
  'securities_lending',
  'cash_yield',
] as const;

/** Movimentação de capital na conta (extrato) — domínio CASH, espelhável no INVEST. */
export const CAPITAL_CASH_OPERATIONS: readonly LedgerTransactionType[] = [
  'capital_deposit',
  'capital_withdrawal',
] as const;

/** Custos e penalidades sem trade — CASH (saídas) ou INVEST fee/penalty. */
export const PASSIVE_EXPENSE_OPERATIONS: readonly LedgerTransactionType[] = [
  'fee',
  'penalty_b3',
] as const;

/** Ganhos/perdas por operação (nota de corretagem). */
export const ACTIVE_TRADE_OPERATIONS: readonly LedgerTransactionType[] = [
  'buy',
  'sell',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
  'split',
  'bonus',
  'opening_balance',
  'revaluation',
] as const;

export type FlowKind = 'passive_income' | 'passive_expense' | 'capital' | 'active_trade' | 'other';

export function classifyLedgerOperation(operation: string): FlowKind {
  const op = operation as LedgerTransactionType;
  if (PASSIVE_INCOME_OPERATIONS.includes(op)) return 'passive_income';
  if (PASSIVE_EXPENSE_OPERATIONS.includes(op)) return 'passive_expense';
  if (CAPITAL_CASH_OPERATIONS.includes(op)) return 'capital';
  if (ACTIVE_TRADE_OPERATIONS.includes(op)) return 'active_trade';
  return 'other';
}

export function isPassiveIncome(operation: string): boolean {
  return classifyLedgerOperation(operation) === 'passive_income';
}

export function isActiveTrade(operation: string): boolean {
  return classifyLedgerOperation(operation) === 'active_trade';
}

/** Aporte ou retirada externa (TED) — quebra o cálculo de rentabilidade se não for ajustado. */
export function isExternalCapitalFlow(operation: string): boolean {
  return classifyLedgerOperation(operation) === 'capital';
}
