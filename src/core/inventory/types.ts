export type PatrimonyStatus = 'active' | 'liquidated' | 'written_off';

export type PatrimonyItemRow = {
  id: string;
  organization_id: string;
  source_module: string;
  category: string;
  subcategory: string;
  identifier: string;
  name: string | null;
  quantity: number;
  quantity_unit: string;
  acquisition_value: number | null;
  current_value: number | null;
  currency: string;
  acquired_at: string | null;
  divested_at: string | null;
  status: PatrimonyStatus;
  metadata: Record<string, unknown> | null;
};

export type PatrimonyLocationRow = {
  id: string;
  organization_id: string;
  location_type: string;
  name: string;
  external_id: string | null;
  address_line: string | null;
  url: string | null;
  metadata: Record<string, unknown> | null;
};

export type MovementType =
  | 'opening_balance'
  | 'acquisition'
  | 'disposition'
  | 'transfer_in'
  | 'transfer_out'
  | 'revaluation'
  | 'split'
  | 'bonus'
  | 'write_off'
  | 'short_open'
  | 'short_close'
  | 'income_in_kind'
  /**
   * Ajuste de custo posterior (custos atrelados a uma operacao patrimonial mas
   * que aparecem em data/fonte diferentes — IRRF de TD, IRRF de opcao,
   * taxa BTC, taxa de custodia, multa rateada, etc).
   *
   *   quantityDelta = 0
   *   unitValue     = valor absoluto do custo a ser incorporado ao item
   *   metadata.applies_to_b3 = true  -> tambem afeta pmB (B3)
   *   metadata.applies_to_b3 = false -> afeta apenas pmA (estrito) e pmC (gerencial)
   *
   * REGRA FISCAL (IN RFB 1.585/2015 + Solucoes de Consulta COSIT):
   *
   * O PM B3 (fiscal) inclui apenas "custos e despesas necessarios a realizacao
   * das operacoes ... que constem das notas de corretagem". Portanto:
   *
   *   SIM no PM B3 (entra via unit_price da linha de acquisition):
   *     - Corretagem, ISS s/ corretagem
   *     - Emolumentos, taxa de liquidacao, taxa de registro
   *     - Taxas de termo/opcoes vinculadas a operacao
   *
   *   NAO no PM B3 (default deste cost_adjustment, applies_to_b3=false):
   *     - IRRF retido (em qualquer ativo: TD, opcoes, swing trade) — eh
   *       antecipacao de IR, vira credito na DARF
   *     - IOF — tributo sobre rendimento
   *     - Taxa de custodia (mensal ou TD 0,2% a.a.) — despesa de manutencao
   *     - Juros/multa saldo negativo na corretora — despesa financeira pessoal
   *     - Custos de BTC (aluguel de acoes), tanto doador quanto tomador
   *
   * O PM Estrito (gerencial-pessoal do investidor) e o PM Gerencial absorvem
   * TODOS esses custos, porque sao gastos efetivos atrelados ao ativo na
   * visao do investidor.
   *
   * Default: applies_to_b3 = false.
   */
  | 'cost_adjustment';

export type PatrimonyLedgerRow = {
  id: string;
  organization_id: string;
  patrimony_item_id: string;
  location_id: string | null;
  transaction_date: string;
  movement_type: MovementType;
  quantity_delta: number;
  unit_value: number;
  total_value: number;
  impacts_valuation: boolean | number;
  related_financial_entry_id: string | null;
  business_event_id: string | null;
  source_batch_id: string | null;
  external_ref: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

export type EnsureItemInput = {
  category: string;
  subcategory: string;
  identifier: string;
  name?: string | null;
  quantityUnit?: string;
  currency?: string;
  metadata?: Record<string, unknown> | null;
};

export type RecordMovementInput = {
  itemId: string;
  locationId?: string | null;
  transactionDate: string;
  movementType: MovementType;
  quantityDelta: number;
  unitValue: number;
  impactsValuation?: boolean;
  externalRef?: string | null;
  /** Header canonico (business_events.id) que esta perna pertence. */
  businessEventId?: string | null;
  sourceBatchId?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Estado de uma posicao no momento atual (snapshot derivado do livro razao).
 * Os campos pmA/pmB/pmC representam ate 3 precos paralelos para estrategias
 * que precisam (ex: INVEST three_prices_invest). Estrategias mais simples
 * usam apenas pmA.
 */
export type PositionState = {
  quantity: number;
  pmA: number; // ex: estrito / FIFO / weighted_avg
  pmB: number | null; // ex: B3 / null
  pmC: number | null; // ex: gerencial / null
  acquisitionValue: number; // soma absoluta de custo (sem abatimentos)
  currentValue: number; // valor atual sugerido = qty * pmA por default
};

export interface InventoryValuation {
  readonly methodCode: string;
  /**
   * Recebe estado atual + movimento; retorna novo estado.
   * As estrategias sao puras: nao tocam no banco.
   */
  applyMovement(state: PositionState, movement: RecordMovementInput): PositionState;
}
