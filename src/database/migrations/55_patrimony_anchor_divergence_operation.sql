-- Divergencia de patrimonio economico vs ancora BTG sem explicacao no livro.
-- Nao ajusta patrimonio nem caixa — evento auditavel para investigacao.

INSERT INTO invest_operation_types (operation_code, canonical_name, description)
VALUES (
  'patrimony_anchor_divergence',
  'Divergencia de Patrimonio vs Ancora',
  'Delta entre patrimonio economico calculado e ancora mensal BTG sem lancamento explicativo correspondente.'
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
  'patrimony_anchor_divergence', 'unknown_invest_event', FALSE, FALSE,
  NULL, 'none', 'cleared',
  FALSE, FALSE, FALSE,
  FALSE, FALSE, FALSE, FALSE,
  FALSE, FALSE, FALSE
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
