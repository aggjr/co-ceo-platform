/** Tipos persistidos em invest_ledger_entries.transaction_type */
export const LEDGER_TRANSACTION_TYPES = [
  'buy',
  'sell',
  'dividend',
  'jcp',
  'split',
  'bonus',
  'option_exercise',
  'fee',
  'revaluation',
  'opening_balance',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'securities_lending',
  'capital_deposit',
  'capital_withdrawal',
  'cash_yield',
  'penalty_b3',
  /** Previsão negativa/positiva de liquidação (lançamentos futuros BTG). */
  'pending_settlement',
] as const;

/** Ticker sintético por corretora para lançamentos de extrato (caixa). */
export const CASH_TICKER_PREFIX = 'CAIXA-';

export type LedgerTransactionType = (typeof LEDGER_TRANSACTION_TYPES)[number];

/** Colunas do relatório tipo pivot (Excel). */
export const PIVOT_COLUMNS = [
  'acao_ganho',
  'dividendos',
  'jcp',
  'put_vendida',
  'put_comprada',
  'call_vendida',
  'call_comprada',
  'locacao',
  'capital_entrada',
  'capital_saida',
  'rendimento_caixa',
  'multas_b3',
  'despesas',
  'total',
] as const;

export type PivotColumnKey = (typeof PIVOT_COLUMNS)[number];

export type PivotColumnLabels = Record<
  Exclude<PivotColumnKey, 'total'>,
  string
>;

export const PIVOT_COLUMN_LABELS: PivotColumnLabels = {
  acao_ganho: 'Ganho ações / FIIs',
  dividendos: 'Dividendos',
  jcp: 'JCP',
  put_vendida: 'Put vendida',
  put_comprada: 'Put comprada',
  call_vendida: 'Call vendida',
  call_comprada: 'Call comprada',
  locacao: 'Locação (líquido)',
  capital_entrada: 'Aporte de capital',
  capital_saida: 'Retirada de capital',
  rendimento_caixa: 'Rendimento em caixa',
  multas_b3: 'Multas / encargos B3',
  despesas: 'Despesas operacionais',
};

export type PivotRow = Record<PivotColumnKey, number> & {
  underlying: string;
  label: string;
};

export type LedgerImportLine = {
  date: string;
  ticker: string;
  operation: LedgerTransactionType;
  quantity: number;
  unit_price: number;
  brokerage_fee?: number;
  b3_fees?: number;
  irrf_tax?: number;
  settlement_date?: string;
  settlement_status?: 'pending' | 'cleared';
  total_net_value?: number;
  underlying_ticker?: string;
  asset_type?: string;
  broker_note_ref?: string;
  notes?: string;
  impacts_managerial_price?: boolean;
  /** Strike de exercício (R$) — persiste em metadata do ativo. */
  option_strike?: number;
};

export type OpeningShortOptionLine = {
  ticker: string;
  operation: 'put_sell' | 'call_sell';
  quantity: number;
  unit_price: number;
  underlying_ticker?: string;
  notes?: string;
};

export type OpeningImportPayload = {
  opening_date: string;
  source_label?: string;
  opening_positions: Array<{
    ticker: string;
    asset_type?: string;
    quantity: number;
    avg_price: number;
    underlying_ticker?: string;
    notes?: string;
    option_strike?: number;
  }>;
  opening_short_options?: OpeningShortOptionLine[];
};

export type LedgerImportPayload = OpeningImportPayload & {
  /** Notas de corretagem, extratos mensais e eventos após a data-base. */
  entries: LedgerImportLine[];
  /** Extratos mensais (opcional — mesmo formato de entries; agrupado só para organização). */
  monthly_statements?: Array<{
    month: string;
    broker?: string;
    entries: LedgerImportLine[];
  }>;
  source_label?: string;
};
