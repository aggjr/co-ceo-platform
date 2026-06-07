-- Migration 44: Invest Cash Account Policy

CREATE TABLE IF NOT EXISTS invest_brokers (
  broker_code VARCHAR(80) NOT NULL,
  canonical_name VARCHAR(180) NOT NULL,
  country_code CHAR(2) NULL,
  default_currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (broker_code),
  INDEX idx_invest_brokers_active (is_active)
);

CREATE TABLE IF NOT EXISTS invest_cash_account_policies (
  id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NULL,
  broker_code VARCHAR(80) NOT NULL,
  source_system VARCHAR(120) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  cash_ticker VARCHAR(120) NOT NULL,
  cash_name VARCHAR(180) NOT NULL,
  financial_account_external_id VARCHAR(180) NOT NULL,
  financial_account_type VARCHAR(80) NOT NULL DEFAULT 'brokerage',
  is_default_for_broker BOOLEAN NOT NULL DEFAULT FALSE,
  is_default_for_currency BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from DATE NOT NULL DEFAULT '1900-01-01',
  valid_to DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_icap_broker
    FOREIGN KEY (broker_code) REFERENCES invest_brokers(broker_code)
    ON DELETE RESTRICT,
  INDEX idx_icap_lookup (
    organization_id,
    broker_code,
    currency_code,
    source_system,
    valid_from,
    valid_to,
    is_active
  ),
  INDEX idx_icap_defaults (organization_id, currency_code, is_default_for_currency, is_active),
  UNIQUE KEY uq_icap_cash_ticker_org (organization_id, cash_ticker)
);

CREATE TABLE IF NOT EXISTS invest_cash_account_bindings (
  id VARCHAR(36) NOT NULL,
  policy_id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  financial_account_id VARCHAR(36) NOT NULL,
  cash_ticker VARCHAR(120) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_icab_policy
    FOREIGN KEY (policy_id) REFERENCES invest_cash_account_policies(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_icab_policy_org (policy_id, organization_id),
  INDEX idx_icab_account (financial_account_id),
  INDEX idx_icab_cash_ticker (organization_id, cash_ticker)
);

-- Seeds / Defaults

INSERT INTO invest_brokers
  (broker_code, canonical_name, country_code, default_currency_code)
VALUES
  ('BTG', 'BTG Pactual', 'BR', 'BRL'),
  ('NECTON_BTG', 'Necton/BTG legado', 'BR', 'BRL'),
  ('XP', 'XP Investimentos', 'BR', 'BRL'),
  ('CLEAR', 'Clear Corretora', 'BR', 'BRL'),
  ('INTERACTIVE_BROKERS', 'Interactive Brokers', 'US', 'USD'),
  ('BINANCE', 'Binance', NULL, 'USD'),
  ('MANUAL', 'Conta manual', NULL, 'BRL')
ON DUPLICATE KEY UPDATE
  canonical_name = VALUES(canonical_name),
  country_code = VALUES(country_code),
  default_currency_code = VALUES(default_currency_code),
  is_active = TRUE;

INSERT INTO invest_cash_account_policies
  (
    id,
    organization_id,
    broker_code,
    source_system,
    currency_code,
    cash_ticker,
    cash_name,
    financial_account_external_id,
    financial_account_type,
    is_default_for_broker,
    is_default_for_currency,
    valid_from,
    priority
  )
VALUES
  (
    'icap-btg-brl-default',
    NULL,
    'BTG',
    NULL,
    'BRL',
    'CAIXA-BTG',
    'Conta Corrente BTG',
    'BTG',
    'brokerage',
    TRUE,
    TRUE,
    '1900-01-01',
    100
  )
ON DUPLICATE KEY UPDATE
  broker_code = VALUES(broker_code),
  currency_code = VALUES(currency_code),
  cash_ticker = VALUES(cash_ticker),
  cash_name = VALUES(cash_name),
  financial_account_external_id = VALUES(financial_account_external_id),
  financial_account_type = VALUES(financial_account_type),
  is_default_for_broker = VALUES(is_default_for_broker),
  is_default_for_currency = VALUES(is_default_for_currency),
  is_active = TRUE;
