-- ==============================================================================
-- CO-CEO PLATFORM | MERCADO (cotações e índices compartilhados entre clientes)
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Dados de mercado são GLOBAIS (sem organization_id): preço de PETR4 em
-- 2026-05-20 é o mesmo para todos os clientes. CDB é a exceção — o instrumento
-- é por cliente (papel emitido em nome dele), mas o PU diário é derivado de
-- market_index_daily + parâmetros do contrato (taxa pré, % CDI, IPCA + spread).

CREATE TABLE market_instruments (
    ticker VARCHAR(32) PRIMARY KEY,
    instrument_type ENUM(
        'stock','fii','etf','bdr',
        'option_call','option_put',
        'tesouro_lft','tesouro_ntnb','tesouro_ltn',
        'cdb_pos','cdb_pre','cdb_ipca',
        'fixed_income_generic'
    ) NOT NULL,
    underlying_ticker VARCHAR(32) NULL,
    emission_date DATE NULL,
    maturity_date DATE NULL,
    index_code VARCHAR(20) NULL,
    index_percent DECIMAL(8, 4) NULL,
    pre_rate DECIMAL(8, 4) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_market_instruments_type (instrument_type),
    INDEX idx_market_instruments_underlying (underlying_ticker)
);

CREATE TABLE market_quotes_daily (
    id VARCHAR(36) PRIMARY KEY,
    ticker VARCHAR(32) NOT NULL,
    quote_date DATE NOT NULL,
    closing_price DECIMAL(18, 6) NOT NULL,
    open_price DECIMAL(18, 6) NULL,
    min_price DECIMAL(18, 6) NULL,
    max_price DECIMAL(18, 6) NULL,
    volume DECIMAL(20, 2) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'BRL',
    source ENUM(
        'brapi','opcoes_net','tesouro_direto',
        'computed_cdi','computed_pre','computed_ipca',
        'user_manual'
    ) NOT NULL,
    source_fetched_at TIMESTAMP NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_market_quotes_ticker_date (ticker, quote_date),
    INDEX idx_market_quotes_date (quote_date),
    INDEX idx_market_quotes_source (source, quote_date)
);

CREATE TABLE market_index_daily (
    id VARCHAR(36) PRIMARY KEY,
    index_code VARCHAR(20) NOT NULL,
    reference_date DATE NOT NULL,
    daily_factor DECIMAL(20, 12) NOT NULL,
    annualized_rate DECIMAL(10, 6) NULL,
    source VARCHAR(40) NOT NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_market_index_code_date (index_code, reference_date),
    INDEX idx_market_index_date (reference_date)
);
