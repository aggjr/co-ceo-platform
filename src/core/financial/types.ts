export type AccountType =
  | 'checking'
  | 'savings'
  | 'brokerage'
  | 'cash_register'
  | 'credit_line'
  | 'gateway'
  | 'wallet';

export type FinancialAccountRow = {
  id: string;
  organization_id: string;
  source_module: string;
  account_type: AccountType;
  external_id: string | null;
  name: string;
  currency: string;
  opening_balance: number;
  opening_date: string | null;
  status: 'active' | 'closed';
  metadata: Record<string, unknown> | null;
};

export type LedgerDirection = 'in' | 'out';
export type LedgerStatus = 'pending' | 'cleared' | 'cancelled';

export type FinancialLedgerRow = {
  id: string;
  organization_id: string;
  account_id: string;
  transaction_date: string;
  settlement_date: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  description: string | null;
  counterparty: string | null;
  status: LedgerStatus;
  related_patrimony_ledger_id: string | null;
  business_event_id: string | null;
  source_batch_id: string | null;
  external_ref: string | null;
  metadata: Record<string, unknown> | null;
};

export type RegisterAccountInput = {
  sourceModule: string;
  accountType: AccountType;
  name: string;
  externalId?: string | null;
  currency?: string;
  openingBalance?: number;
  openingDate?: string | null;
  metadata?: Record<string, unknown>;
};

export type RecordCashMovementInput = {
  accountId: string;
  transactionDate: string;
  settlementProfileCode?: string;
  settlementDate?: string;
  direction: LedgerDirection;
  amount: number;
  currency?: string;
  description?: string;
  counterparty?: string;
  status?: LedgerStatus;
  relatedPatrimonyLedgerId?: string | null;
  /** Header canonico (business_events.id) que esta perna pertence. */
  businessEventId?: string | null;
  externalRef?: string | null;
  sourceBatchId?: string | null;
  metadata?: Record<string, unknown>;
};
