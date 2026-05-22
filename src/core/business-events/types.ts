export type BusinessEventKind =
  // INVEST
  | 'opening_balance'
  | 'broker_note_spot'
  | 'broker_note_option'
  | 'broker_note_loan'
  | 'cash_movement'
  | 'cash_yield_event'
  | 'corporate_action'
  // STOCKSPIN (futuro)
  | 'inventory_purchase'
  | 'inventory_sale'
  | 'inventory_adjustment'
  // CASH (futuro)
  | 'manual_entry'
  | 'boleto_payment'
  | 'invoice_issued'
  | 'invoice_received';

export type BusinessEventRow = {
  id: string;
  organization_id: string;
  source_module: string;
  event_kind: BusinessEventKind | string;
  occurred_on: string;
  settles_on: string | null;
  source_ref: string | null;
  counterparty: string | null;
  total_gross: number;
  total_costs: number;
  total_net: number;
  source_system: string;
  source_version: string | null;
  recorded_by_user_id: string | null;
  recorded_at: string;
  revision_no: number;
  supersedes_event_id: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CreateBusinessEventInput = {
  sourceModule: string;
  eventKind: BusinessEventKind | string;
  occurredOn: string;
  settlesOn?: string | null;
  sourceRef?: string | null;
  counterparty?: string | null;
  totalGross?: number;
  totalCosts?: number;
  totalNet?: number;
  sourceSystem: string;
  sourceVersion?: string | null;
  recordedByUserId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Pernas associadas a um header de business_events. Note que cada lista vem
 * com a ordem cronologica + sequencial de criacao (igual ao InventoryLedger).
 */
export type BusinessEventLegs = {
  patrimonyLegs: Record<string, unknown>[];
  financialLegs: Record<string, unknown>[];
};

export type LegKind = 'patrimony' | 'financial';

/**
 * Resultado da conciliacao header vs. pernas. `consistent=true` quando todas
 * as somas batem (com tolerancia de 0.01) e nao ha perna orfa.
 */
export type EventReconciliationReport = {
  eventId: string;
  consistent: boolean;
  totalNetHeader: number;
  totalNetLegs: number;
  delta: number;
  patrimonyLegCount: number;
  financialLegCount: number;
  issues: string[];
};
