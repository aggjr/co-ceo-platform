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
  /**
   * Ajuste de custo posterior: gera 1 perna patrimony 'cost_adjustment'
   * (quantity=0, unit_value=custo) NO ITEM `ticker` e 1 perna financial 'out'
   * no caixa. Use para IRRF de TD, taxa BTC, multa, custodia, etc. Ver
   * docstring de MovementType.cost_adjustment.
   */
  'cost_adjustment',
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
  /**
   * Header canonico (business_events.id) que esta linha pertence. Quando o
   * caller (ex: import-btg-notes) ja agrupou as N pernas de uma mesma nota,
   * passa o mesmo ID em todas. Quando vazio, InvestOperations cria 1 header
   * automatico por linha (caso de cash_movement do extrato).
   */
  business_event_id?: string;
  /**
   * Chave do header agregador (business_events.source_ref). Multiplas linhas
   * com o MESMO event_source_ref caem no MESMO business_events.id via
   * BusinessEventRegistry.ensureByRef.
   *
   * Padroes adotados:
   *   - 'BTG-NOTA-{noteNumber}' → 1 header por nota de corretagem
   *   - 'OPENING:{date}'        → 1 header para o opening
   *   - vazio                   → cada linha vira 1 header avulso (cash_movement)
   *
   * Difere de `broker_note_ref` (que continua sendo idempotencia da perna
   * via external_ref). Ver docs/architecture/business_events_integration_plan.md.
   */
  event_source_ref?: string;
  /** Sistema/parser que gerou (rastreabilidade). Ex: 'btg_extract_import'. */
  source_system?: string;
  /** Versao do parser (commit sha curto). */
  source_version?: string;
  /** Contraparte legivel: 'BTG Pactual', etc. */
  counterparty?: string;
  /**
   * Quando operation = 'cost_adjustment', define se o custo sobe tambem o
   * pmB (B3/fiscal). Default false (regra geral pra IRRF/IOF/custodia/multa).
   * Ver tabela em MovementType.cost_adjustment.
   */
  applies_to_b3?: boolean;
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
