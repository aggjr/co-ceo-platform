-- Tipos de operação para pivot (opções, locação, saldo inicial) + metadados de nota

ALTER TABLE invest_ledger_entries
  MODIFY transaction_type ENUM(
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
    'securities_lending'
  ) NOT NULL,
  ADD COLUMN underlying_ticker VARCHAR(20) NULL AFTER asset_id,
  ADD COLUMN broker_note_ref VARCHAR(64) NULL AFTER notes,
  ADD COLUMN source_batch_id VARCHAR(36) NULL AFTER broker_note_ref;

CREATE INDEX idx_invest_ledger_org_date ON invest_ledger_entries (organization_id, transaction_date);
