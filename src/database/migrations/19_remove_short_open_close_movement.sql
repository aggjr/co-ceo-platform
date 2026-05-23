-- 19_remove_short_open_close_movement.sql
--
-- Remove os valores 'short_open' e 'short_close' do ENUM movement_type.
--
-- Motivacao: toda venda e `disposition` e toda compra e `acquisition`,
-- independente do estado do estoque. O estado "short" (posicao vendida
-- liquida) e derivado pelo signo da quantity resultante — nao eh um tipo
-- separado de movimento. Ver src/core/inventory/types.ts (MovementType).
--
-- PRECONDITION: nao deve existir nenhuma linha com movement_type IN
-- ('short_open', 'short_close') antes de rodar esta migration. Faca
-- SELECT COUNT(*) FROM patrimony_ledger_entries WHERE movement_type IN
-- ('short_open','short_close') para confirmar antes de aplicar.
--
-- Idempotente: se os valores ja foram removidos (migration 17 ja aplicada
-- sem eles), o ALTER nao tem efeito colateral.

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
