CREATE TABLE IF NOT EXISTS invest_operation_types (
  operation_code VARCHAR(80) NOT NULL,
  module_code VARCHAR(40) NOT NULL DEFAULT 'INVEST',
  canonical_name VARCHAR(180) NOT NULL,
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_code),
  INDEX idx_iot_module_active (module_code, is_active)
);

CREATE TABLE IF NOT EXISTS invest_operation_policies (
  operation_code VARCHAR(80) NOT NULL,
  business_event_kind VARCHAR(80) NOT NULL,
  affects_portfolio BOOLEAN NOT NULL DEFAULT FALSE,
  affects_financial BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_movement_type VARCHAR(80) NULL,
  cash_direction ENUM('in', 'out', 'none', 'signed') NOT NULL DEFAULT 'none',
  default_financial_status ENUM('pending', 'cleared') NOT NULL DEFAULT 'cleared',
  uses_settlement_rules BOOLEAN NOT NULL DEFAULT FALSE,
  requires_instrument BOOLEAN NOT NULL DEFAULT FALSE,
  requires_cash_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_external_flow_for_twr BOOLEAN NOT NULL DEFAULT FALSE,
  is_trade BOOLEAN NOT NULL DEFAULT FALSE,
  is_option_trade BOOLEAN NOT NULL DEFAULT FALSE,
  is_corporate_action BOOLEAN NOT NULL DEFAULT FALSE,
  is_passive_income BOOLEAN NOT NULL DEFAULT FALSE,
  is_passive_expense BOOLEAN NOT NULL DEFAULT FALSE,
  is_opening BOOLEAN NOT NULL DEFAULT FALSE,
  default_pivot_column VARCHAR(80) NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_code),
  CONSTRAINT fk_iop_operation
    FOREIGN KEY (operation_code) REFERENCES invest_operation_types(operation_code)
    ON DELETE CASCADE,
  INDEX idx_iop_event_kind (business_event_kind),
  INDEX idx_iop_flags (is_trade, is_option_trade, is_passive_income, is_passive_expense)
);

CREATE TABLE IF NOT EXISTS invest_operation_asset_overrides (
  id VARCHAR(36) NOT NULL,
  operation_code VARCHAR(80) NOT NULL,
  asset_type VARCHAR(80) NOT NULL,
  affects_portfolio BOOLEAN NULL,
  affects_financial BOOLEAN NULL,
  inventory_movement_type VARCHAR(80) NULL,
  cash_direction ENUM('in', 'out', 'none', 'signed') NULL,
  default_financial_status ENUM('pending', 'cleared') NULL,
  uses_settlement_rules BOOLEAN NULL,
  requires_instrument BOOLEAN NULL,
  requires_cash_account BOOLEAN NULL,
  is_external_flow_for_twr BOOLEAN NULL,
  valid_from DATE NOT NULL DEFAULT '1900-01-01',
  valid_to DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_ioao_operation
    FOREIGN KEY (operation_code) REFERENCES invest_operation_types(operation_code)
    ON DELETE CASCADE,
  INDEX idx_ioao_lookup (operation_code, asset_type, valid_from, valid_to, is_active)
);

-- Seeds
INSERT INTO invest_operation_types (operation_code, canonical_name) VALUES
('buy', 'Compra de Ativo'),
('sell', 'Venda de Ativo'),
('dividend', 'Dividendos'),
('jcp', 'Juros sobre Capital Próprio'),
('split', 'Desdobramento'),
('bonus', 'Bonificação'),
('option_exercise', 'Exercício de Opção'),
('fee', 'Taxas e Emolumentos'),
('revaluation', 'Reavaliação Patrimonial'),
('opening_balance', 'Saldo Inicial'),
('put_sell', 'Venda de Put'),
('put_buy', 'Compra de Put'),
('call_sell', 'Venda de Call'),
('call_buy', 'Compra de Call'),
('securities_lending', 'Aluguel de Ações (Doador)'),
('capital_deposit', 'Aporte de Capital'),
('capital_withdrawal', 'Retirada de Capital'),
('cash_yield', 'Rendimento de Caixa'),
('penalty_b3', 'Multa B3'),
('pending_settlement', 'Liquidação Pendente'),
('cost_adjustment', 'Ajuste de Custo')
ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name);

INSERT INTO invest_operation_policies (
  operation_code, business_event_kind, affects_portfolio, affects_financial, 
  inventory_movement_type, cash_direction, default_financial_status, 
  uses_settlement_rules, requires_instrument, requires_cash_account, 
  is_external_flow_for_twr, is_trade, is_option_trade, is_corporate_action, 
  is_passive_income, is_passive_expense, is_opening
) VALUES
('opening_balance', 'opening_balance', TRUE, TRUE, 'opening_balance', 'signed', 'cleared', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE),
('buy', 'broker_note_spot', TRUE, TRUE, 'acquisition', 'out', 'cleared', TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
('sell', 'broker_note_spot', TRUE, TRUE, 'disposition', 'in', 'cleared', TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
('put_sell', 'broker_note_option', TRUE, TRUE, 'disposition', 'in', 'cleared', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('put_buy', 'broker_note_option', TRUE, TRUE, 'acquisition', 'out', 'cleared', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('call_sell', 'broker_note_option', TRUE, TRUE, 'disposition', 'in', 'cleared', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('call_buy', 'broker_note_option', TRUE, TRUE, 'acquisition', 'out', 'cleared', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('option_exercise', 'broker_note_option', TRUE, TRUE, 'signed_quantity', 'signed', 'cleared', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('split', 'corporate_action', TRUE, FALSE, 'split', 'none', 'cleared', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE),
('bonus', 'corporate_action', TRUE, FALSE, 'bonus', 'none', 'cleared', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE),
('revaluation', 'corporate_action', TRUE, FALSE, 'revaluation', 'none', 'cleared', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE),
('dividend', 'cash_movement', FALSE, TRUE, NULL, 'in', 'cleared', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE),
('jcp', 'cash_movement', FALSE, TRUE, NULL, 'in', 'cleared', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE),
('cash_yield', 'cash_movement', FALSE, TRUE, NULL, 'in', 'cleared', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE),
('securities_lending', 'broker_note_loan', FALSE, TRUE, 'cost_adjustment', 'in', 'cleared', TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE),
('fee', 'cash_movement', FALSE, TRUE, 'cost_adjustment', 'out', 'cleared', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
('penalty_b3', 'cash_movement', FALSE, TRUE, 'cost_adjustment', 'out', 'cleared', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
('cost_adjustment', 'cash_movement', TRUE, TRUE, 'cost_adjustment', 'out', 'cleared', FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
('capital_deposit', 'cash_movement', FALSE, TRUE, NULL, 'in', 'cleared', FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
('capital_withdrawal', 'cash_movement', FALSE, TRUE, NULL, 'out', 'cleared', FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
('pending_settlement', 'broker_note_spot', FALSE, TRUE, NULL, 'signed', 'pending', TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE)
ON DUPLICATE KEY UPDATE 
  business_event_kind = VALUES(business_event_kind),
  affects_portfolio = VALUES(affects_portfolio),
  affects_financial = VALUES(affects_financial),
  inventory_movement_type = VALUES(inventory_movement_type),
  cash_direction = VALUES(cash_direction),
  default_financial_status = VALUES(default_financial_status),
  uses_settlement_rules = VALUES(uses_settlement_rules),
  requires_instrument = VALUES(requires_instrument),
  requires_cash_account = VALUES(requires_cash_account),
  is_external_flow_for_twr = VALUES(is_external_flow_for_twr),
  is_trade = VALUES(is_trade),
  is_option_trade = VALUES(is_option_trade),
  is_corporate_action = VALUES(is_corporate_action),
  is_passive_income = VALUES(is_passive_income),
  is_passive_expense = VALUES(is_passive_expense),
  is_opening = VALUES(is_opening);
