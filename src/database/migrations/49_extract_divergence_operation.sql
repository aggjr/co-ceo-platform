-- Adiciona tipo 'extract_divergence' ao catalogo de operacoes.
-- Representa movimentos no extrato da corretora sem correspondencia em
-- nenhuma regra de classificacao conhecida. Sao importados como lancamentos
-- de caixa para garantir o batimento de saldo e devem ser investigados
-- junto a corretora.
-- Idempotente: ON DUPLICATE KEY UPDATE garante reexecucao segura.

INSERT INTO invest_operation_types (operation_code, canonical_name, description)
VALUES (
  'extract_divergence',
  'Extrato Divergente',
  'Movimento no extrato da corretora sem classificacao conhecida. Importado para batimento de saldo e requer investigacao junto a corretora.'
)
ON DUPLICATE KEY UPDATE
  canonical_name = VALUES(canonical_name),
  description    = VALUES(description);

INSERT INTO invest_operation_policies (
  operation_code, business_event_kind, affects_portfolio, affects_financial,
  inventory_movement_type, cash_direction, default_financial_status,
  uses_settlement_rules, requires_instrument, requires_cash_account,
  is_external_flow_for_twr, is_trade, is_option_trade, is_corporate_action,
  is_passive_income, is_passive_expense, is_opening
) VALUES (
  'extract_divergence', 'cash_movement', FALSE, TRUE,
  NULL, 'in', 'cleared',
  FALSE, FALSE, FALSE,
  FALSE, FALSE, FALSE, FALSE,
  TRUE, FALSE, FALSE
)
ON DUPLICATE KEY UPDATE
  business_event_kind      = VALUES(business_event_kind),
  affects_portfolio        = VALUES(affects_portfolio),
  affects_financial        = VALUES(affects_financial),
  inventory_movement_type  = VALUES(inventory_movement_type),
  cash_direction           = VALUES(cash_direction),
  default_financial_status = VALUES(default_financial_status),
  uses_settlement_rules    = VALUES(uses_settlement_rules),
  requires_instrument      = VALUES(requires_instrument),
  requires_cash_account    = VALUES(requires_cash_account),
  is_external_flow_for_twr = VALUES(is_external_flow_for_twr),
  is_trade                 = VALUES(is_trade),
  is_option_trade          = VALUES(is_option_trade),
  is_corporate_action      = VALUES(is_corporate_action),
  is_passive_income        = VALUES(is_passive_income),
  is_passive_expense       = VALUES(is_passive_expense),
  is_opening               = VALUES(is_opening);
