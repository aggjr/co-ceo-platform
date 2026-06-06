-- ============================================================================
-- INVEST | Infraestrutura generica de mercado, moeda, fontes e taxas
-- ============================================================================
-- Esta migration consolida a direcao arquitetural do INVEST:
-- - tipos/fonte de cotacao deixam de depender de ENUM fechado;
-- - bolsas/mercados e cambio viram dados;
-- - mapeamento de ticker para provedor externo fica em tabela;
-- - tabelas de taxas usam relacao N:N com tipos de ativo, sem CSV.

CREATE TABLE IF NOT EXISTS exchanges (
  code VARCHAR(40) NOT NULL,
  canonical_name VARCHAR(160) NOT NULL,
  country_code CHAR(2) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  trading_calendar_code VARCHAR(80) NOT NULL DEFAULT 'weekdays',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE market_instruments
  MODIFY instrument_type VARCHAR(80) NOT NULL;

ALTER TABLE market_quotes_daily
  MODIFY source VARCHAR(50) NOT NULL;

ALTER TABLE module_quote_sources
  MODIFY base_currency CHAR(3) NOT NULL DEFAULT 'BRL';

CREATE TABLE IF NOT EXISTS market_quote_source_mappings (
  source_code VARCHAR(50) NOT NULL,
  ticker VARCHAR(64) NOT NULL,
  provider_symbol VARCHAR(160) NOT NULL,
  provider_currency CHAR(3) NULL,
  metadata JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_code, ticker),
  CONSTRAINT fk_mqsm_source
    FOREIGN KEY (source_code) REFERENCES module_quote_sources(source_code)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fx_rates (
  id VARCHAR(36) NOT NULL,
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  rate_date DATE NOT NULL,
  closing_rate DECIMAL(20, 8) NOT NULL,
  source VARCHAR(50) NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fx_rates_pair_date (from_currency, to_currency, rate_date),
  INDEX idx_fx_rates_date (rate_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_schedules (
  fee_schedule_code VARCHAR(80) NOT NULL,
  broker_code VARCHAR(80) NOT NULL,
  exchange_code VARCHAR(40) NOT NULL,
  fee_type VARCHAR(80) NOT NULL,
  calculation_base VARCHAR(80) NOT NULL DEFAULT 'gross_value',
  rate_pct DECIMAL(18, 10) NULL,
  fixed_amount DECIMAL(20, 6) NULL,
  min_amount DECIMAL(20, 6) NULL,
  max_amount DECIMAL(20, 6) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (fee_schedule_code),
  INDEX idx_fee_schedule_lookup (broker_code, exchange_code, fee_type, valid_from, valid_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_schedule_asset_types (
  fee_schedule_code VARCHAR(80) NOT NULL,
  asset_type VARCHAR(80) NOT NULL,
  PRIMARY KEY (fee_schedule_code, asset_type),
  CONSTRAINT fk_fee_schedule_asset_type
    FOREIGN KEY (fee_schedule_code) REFERENCES fee_schedules(fee_schedule_code)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE module_categories
  ADD COLUMN exchange_code VARCHAR(40) NULL AFTER default_quote_source,
  ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'BRL' AFTER exchange_code,
  ADD COLUMN default_settlement_counterparty_code VARCHAR(80) NULL AFTER currency_code,
  ADD COLUMN default_settlement_contract_type_code VARCHAR(80) NULL AFTER default_settlement_counterparty_code,
  ADD COLUMN affects_portfolio BOOLEAN NOT NULL DEFAULT TRUE AFTER default_settlement_contract_type_code,
  ADD COLUMN affects_financial BOOLEAN NOT NULL DEFAULT TRUE AFTER affects_portfolio;

INSERT INTO exchanges
  (code, canonical_name, country_code, currency_code, timezone, trading_calendar_code)
VALUES
  ('B3_BR', 'B3 Brasil Bolsa Balcao', 'BR', 'BRL', 'America/Sao_Paulo', 'B3'),
  ('TESOURO_BR', 'Tesouro Direto', 'BR', 'BRL', 'America/Sao_Paulo', 'B3'),
  ('NYSE_US', 'New York Stock Exchange', 'US', 'USD', 'America/New_York', 'US_MARKET'),
  ('NASDAQ_US', 'NASDAQ', 'US', 'USD', 'America/New_York', 'US_MARKET'),
  ('CRYPTO_GLOBAL', 'Mercado global de criptoativos', NULL, 'USD', 'UTC', 'ALWAYS')
ON DUPLICATE KEY UPDATE
  canonical_name = VALUES(canonical_name),
  country_code = VALUES(country_code),
  currency_code = VALUES(currency_code),
  timezone = VALUES(timezone),
  trading_calendar_code = VALUES(trading_calendar_code),
  is_active = TRUE;

INSERT IGNORE INTO module_quote_sources
  (source_code, description, base_currency, requires_ticker_mapping, adapter_code)
VALUES
  ('ptax', 'Banco Central do Brasil - PTAX', 'BRL', FALSE, 'ptax');

UPDATE module_quote_sources
SET base_currency = 'USD', requires_ticker_mapping = TRUE
WHERE source_code IN ('coingecko', 'yahoo_finance');

UPDATE module_categories SET
  exchange_code = 'B3_BR',
  currency_code = 'BRL',
  default_settlement_counterparty_code = 'B3_BR',
  default_settlement_contract_type_code = 'B3_EQUITY_SPOT'
WHERE module_code = 'INVEST'
  AND category = 'financial_asset'
  AND subcategory IN ('stock', 'fii', 'etf', 'bdr');

UPDATE module_categories SET
  exchange_code = 'B3_BR',
  currency_code = 'BRL',
  default_settlement_counterparty_code = 'B3_BR',
  default_settlement_contract_type_code = 'B3_OPTION_PREMIUM'
WHERE module_code = 'INVEST'
  AND category = 'financial_asset'
  AND subcategory IN ('option_call', 'option_put');

UPDATE module_categories SET
  exchange_code = 'TESOURO_BR',
  currency_code = 'BRL',
  default_settlement_counterparty_code = 'TESOURO_BR',
  default_settlement_contract_type_code = 'BR_FIXED_INCOME_SPOT'
WHERE module_code = 'INVEST'
  AND category = 'financial_asset'
  AND subcategory = 'fixed_income';

INSERT INTO module_categories
  (module_code, category, subcategory, canonical_name, default_quantity_unit,
   default_valuation_method, default_settlement_profile,
   contributes_to_patrimony, requires_market_quote, default_quote_source, valuation_mode,
   exchange_code, currency_code, default_settlement_counterparty_code,
   default_settlement_contract_type_code, affects_portfolio, affects_financial)
VALUES
  ('INVEST', 'financial_asset', 'stock_us', 'Acao exterior', 'un',
   'three_prices_invest', 'B3_D2',
   TRUE, TRUE, 'yahoo_finance', 'market_price',
   'NYSE_US', 'USD', 'NYSE_US', 'B3_EQUITY_SPOT', TRUE, TRUE),
  ('INVEST', 'financial_asset', 'etf_us', 'ETF exterior', 'cota',
   'three_prices_invest', 'B3_D2',
   TRUE, TRUE, 'yahoo_finance', 'market_price',
   'NYSE_US', 'USD', 'NYSE_US', 'B3_EQUITY_SPOT', TRUE, TRUE),
  ('INVEST', 'financial_asset', 'reit', 'REIT exterior', 'cota',
   'three_prices_invest', 'B3_D2',
   TRUE, TRUE, 'yahoo_finance', 'market_price',
   'NYSE_US', 'USD', 'NYSE_US', 'B3_EQUITY_SPOT', TRUE, TRUE),
  ('INVEST', 'financial_asset', 'crypto', 'Criptoativo', 'un',
   'weighted_avg', 'INSTANT',
   TRUE, TRUE, 'coingecko', 'market_price',
   'CRYPTO_GLOBAL', 'USD', 'CRYPTO_GLOBAL', NULL, TRUE, TRUE),
  ('INVEST', 'financial_asset', 'securities_lending', 'Aluguel ou termo de ativo', 'un',
   'weighted_avg', 'NET_30',
   TRUE, FALSE, NULL, 'historical_cost',
   'B3_BR', 'BRL', 'B3_BR', 'SECURITIES_LENDING', TRUE, TRUE)
ON DUPLICATE KEY UPDATE
  canonical_name = VALUES(canonical_name),
  default_quantity_unit = VALUES(default_quantity_unit),
  default_valuation_method = VALUES(default_valuation_method),
  default_settlement_profile = VALUES(default_settlement_profile),
  contributes_to_patrimony = VALUES(contributes_to_patrimony),
  requires_market_quote = VALUES(requires_market_quote),
  default_quote_source = VALUES(default_quote_source),
  valuation_mode = VALUES(valuation_mode),
  exchange_code = VALUES(exchange_code),
  currency_code = VALUES(currency_code),
  default_settlement_counterparty_code = VALUES(default_settlement_counterparty_code),
  default_settlement_contract_type_code = VALUES(default_settlement_contract_type_code),
  affects_portfolio = VALUES(affects_portfolio),
  affects_financial = VALUES(affects_financial),
  is_active = TRUE;

INSERT INTO fee_schedules
  (fee_schedule_code, broker_code, exchange_code, fee_type, calculation_base,
   rate_pct, fixed_amount, currency_code, valid_from, priority)
VALUES
  ('BTG_B3_EMOLUMENTO_EQUITY_2019', 'BTG_BR', 'B3_BR', 'emolumento_b3', 'gross_value',
   0.0032500000, NULL, 'BRL', '2019-01-01', 100),
  ('BTG_B3_LIQUIDACAO_EQUITY_2019', 'BTG_BR', 'B3_BR', 'taxa_liquidacao', 'gross_value',
   0.0200000000, NULL, 'BRL', '2019-01-01', 100),
  ('BTG_B3_EMOLUMENTO_OPTION_2019', 'BTG_BR', 'B3_BR', 'emolumento_b3', 'gross_value',
   0.0050000000, NULL, 'BRL', '2019-01-01', 100),
  ('BTG_B3_LIQUIDACAO_OPTION_2019', 'BTG_BR', 'B3_BR', 'taxa_liquidacao', 'gross_value',
   0.0200000000, NULL, 'BRL', '2019-01-01', 100),
  ('BTG_B3_REGISTRO_OPTION_2019', 'BTG_BR', 'B3_BR', 'taxa_registro', 'gross_value',
   0.0094000000, NULL, 'BRL', '2019-01-01', 100)
ON DUPLICATE KEY UPDATE
  rate_pct = VALUES(rate_pct),
  fixed_amount = VALUES(fixed_amount),
  currency_code = VALUES(currency_code),
  valid_from = VALUES(valid_from),
  priority = VALUES(priority),
  is_active = TRUE;

INSERT IGNORE INTO fee_schedule_asset_types (fee_schedule_code, asset_type) VALUES
  ('BTG_B3_EMOLUMENTO_EQUITY_2019', 'stock'),
  ('BTG_B3_EMOLUMENTO_EQUITY_2019', 'fii'),
  ('BTG_B3_EMOLUMENTO_EQUITY_2019', 'etf'),
  ('BTG_B3_EMOLUMENTO_EQUITY_2019', 'bdr'),
  ('BTG_B3_LIQUIDACAO_EQUITY_2019', 'stock'),
  ('BTG_B3_LIQUIDACAO_EQUITY_2019', 'fii'),
  ('BTG_B3_LIQUIDACAO_EQUITY_2019', 'etf'),
  ('BTG_B3_LIQUIDACAO_EQUITY_2019', 'bdr'),
  ('BTG_B3_EMOLUMENTO_OPTION_2019', 'option_call'),
  ('BTG_B3_EMOLUMENTO_OPTION_2019', 'option_put'),
  ('BTG_B3_LIQUIDACAO_OPTION_2019', 'option_call'),
  ('BTG_B3_LIQUIDACAO_OPTION_2019', 'option_put'),
  ('BTG_B3_REGISTRO_OPTION_2019', 'option_call'),
  ('BTG_B3_REGISTRO_OPTION_2019', 'option_put');
