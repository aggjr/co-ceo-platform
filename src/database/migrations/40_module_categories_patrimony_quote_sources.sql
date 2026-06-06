-- ============================================================================
-- Migration 40 - module_categories: patrimonio e fontes de cotacao
-- Regra de negocio fica no catalogo, nao em if/Set de service.
-- ============================================================================

ALTER TABLE module_categories
  ADD COLUMN contributes_to_patrimony BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'TRUE = subcategoria soma ao patrimonio economico diario',
  ADD COLUMN requires_market_quote BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'TRUE = subcategoria precisa de cotacao de mercado para valoracao',
  ADD COLUMN default_quote_source VARCHAR(50) NULL
    COMMENT 'Fonte padrao de cotacao para esta subcategoria',
  ADD COLUMN valuation_mode ENUM('market_price', 'computed', 'historical_cost') NOT NULL DEFAULT 'historical_cost'
    COMMENT 'Como a subcategoria e valorada no fechamento diario';

CREATE TABLE IF NOT EXISTS module_quote_sources (
  source_code VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  base_currency VARCHAR(10) NOT NULL DEFAULT 'BRL',
  requires_ticker_mapping BOOLEAN NOT NULL DEFAULT FALSE,
  adapter_code VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO module_quote_sources
  (source_code, description, base_currency, requires_ticker_mapping, adapter_code)
VALUES
  ('brapi', 'BRAPI - acoes, FIIs, ETFs e BDRs B3', 'BRL', FALSE, 'brapi'),
  ('opcoes_net', 'Opcoes.net - opcoes B3', 'BRL', FALSE, 'opcoes_net'),
  ('tesouro_direto', 'Tesouro Direto', 'BRL', FALSE, 'tesouro_direto'),
  ('computed_cdi', 'Calculado - CDI acumulado', 'BRL', FALSE, 'computed_cdi'),
  ('computed_pre', 'Calculado - taxa PRE', 'BRL', FALSE, 'computed_pre'),
  ('computed_ipca', 'Calculado - IPCA + spread', 'BRL', FALSE, 'computed_ipca'),
  ('yahoo_finance', 'Yahoo Finance', 'USD', TRUE, 'yahoo_finance'),
  ('coingecko', 'CoinGecko - criptoativos', 'BRL', TRUE, 'coingecko'),
  ('user_manual', 'Entrada manual pelo usuario', 'BRL', FALSE, 'user_manual');

ALTER TABLE market_quotes_daily
  MODIFY source ENUM(
    'brapi','opcoes_net','tesouro_direto',
    'computed_cdi','computed_pre','computed_ipca',
    'yahoo_finance','coingecko',
    'user_manual'
  ) NOT NULL;

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote = TRUE,
  default_quote_source = 'brapi',
  valuation_mode = 'market_price'
WHERE module_code = 'INVEST'
  AND subcategory IN ('stock', 'fii', 'etf', 'bdr');

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote = TRUE,
  default_quote_source = 'opcoes_net',
  valuation_mode = 'market_price'
WHERE module_code = 'INVEST'
  AND subcategory IN ('option_call', 'option_put');

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote = TRUE,
  default_quote_source = 'tesouro_direto',
  valuation_mode = 'market_price'
WHERE module_code = 'INVEST'
  AND subcategory = 'fixed_income';
