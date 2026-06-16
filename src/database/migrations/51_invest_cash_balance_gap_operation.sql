-- Adiciona o tipo de operacao 'cash_balance_gap' ao catalogo INVEST.
--
-- Representa a DIFERENCA DE SALDO DESCONHECIDA: residuo entre o saldo de caixa
-- calculado pelo sistema (livro razao) e o saldo informado pela corretora, sem
-- correspondencia em nenhum lancamento conhecido. Diferente de 'extract_divergence'
-- (que e uma linha REAL do extrato sem classificacao); aqui o proprio extrato nao
-- explica a diferenca. Lancado como evento de caixa explicito e auditavel
-- (substitui o antigo plug silencioso, ja desativado) para que o usuario possa
-- filtrar por este tipo e questionar a corretora.
--
-- Os dois tipos de "diferenca desconhecida" sao filtraveis por operation_code:
--   - extract_divergence : entrada/saida real do extrato sem classificacao
--   - cash_balance_gap    : residuo de saldo (sistema vs corretora) sem lancamento
--
-- Idempotente: ON DUPLICATE KEY UPDATE garante reexecucao segura.

INSERT INTO invest_operation_types (operation_code, canonical_name, description)
VALUES (
  'cash_balance_gap',
  'Diferenca de Saldo Desconhecida',
  'Residuo entre o saldo do sistema e o saldo da corretora sem lancamento correspondente. Evento explicito para investigacao junto a corretora.'
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
  'cash_balance_gap', 'cash_movement', FALSE, TRUE,
  NULL, 'signed', 'cleared',
  FALSE, FALSE, TRUE,
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
