-- 17_cost_adjustment_movement.sql
-- Adiciona o movement_type 'cost_adjustment' ao patrimony_ledger_entries.
--
-- Esse tipo representa um custo posterior a operacao geradora (IRRF de TD,
-- taxa BTC, IRRF de opcao, etc) que deve ser incorporado ao item patrimonial
-- sem mexer na quantidade. A logica de PM esta em
-- src/modules/invest/ThreePricesValuation.ts (cost_adjustment branch).
--
-- Semantica:
--   quantity_delta = 0
--   unit_value     = valor absoluto do custo incorporado
--   metadata.applies_to_b3 = true|false (default false)
--
-- Idempotente: roda ALTER multiplas vezes sem efeito colateral.

ALTER TABLE patrimony_ledger_entries
  MODIFY COLUMN movement_type ENUM(
    'opening_balance',
    'acquisition',
    'disposition',
    'transfer_in',
    'transfer_out',
    'revaluation',
    'split',
    'bonus',
    'write_off',
    'income_in_kind',
    'cost_adjustment'
  ) NOT NULL;
