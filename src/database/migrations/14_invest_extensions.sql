-- ==============================================================================
-- CO-CEO PLATFORM | EXTENSOES DO MODULO INVEST
-- ver: docs/architecture/nucleo_patrimonial.md
-- ==============================================================================
-- Atributos especificos de ativos financeiros que nao tem sentido no nucleo.

CREATE TABLE invest_position_ext (
    patrimony_item_id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    asset_class ENUM('stock', 'fii', 'option_call', 'option_put', 'fixed_income', 'etf', 'bdr') NOT NULL,
    underlying_ticker VARCHAR(20) NULL,
    pm_estrito DECIMAL(18, 6) NULL,
    pm_b3 DECIMAL(18, 6) NULL,
    pm_gerencial DECIMAL(18, 6) NULL,
    last_price DECIMAL(18, 6) NULL,
    last_price_as_of DATE NULL,
    sector VARCHAR(120) NULL,
    issuer_name VARCHAR(255) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (patrimony_item_id) REFERENCES patrimony_items(id),
    INDEX idx_invest_pos_underlying (organization_id, underlying_ticker)
);

CREATE TABLE invest_option_ext (
    patrimony_item_id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    option_type ENUM('CALL', 'PUT') NOT NULL,
    underlying_ticker VARCHAR(20) NOT NULL,
    strike_price DECIMAL(18, 6) NOT NULL,
    expiration_date DATE NOT NULL,
    european_american ENUM('E', 'A') NOT NULL DEFAULT 'A',
    delta DECIMAL(10, 6) NULL,
    gamma DECIMAL(10, 6) NULL,
    theta DECIMAL(10, 6) NULL,
    vega DECIMAL(10, 6) NULL,
    implied_volatility DECIMAL(10, 6) NULL,
    last_greeks_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (patrimony_item_id) REFERENCES patrimony_items(id),
    INDEX idx_invest_option_underlying_exp (organization_id, underlying_ticker, expiration_date)
);

-- Cache de opcoes (B3 / Opcoes.net) — dado de mercado, nao posicao.
-- Substitui invest_options_chain renomeando o conceito sem mudar o uso.
CREATE TABLE invest_options_market (
    ticker VARCHAR(20) PRIMARY KEY,
    underlying_ticker VARCHAR(20) NOT NULL,
    option_type ENUM('CALL', 'PUT') NOT NULL,
    strike_price DECIMAL(18, 6) NOT NULL,
    expiration_date DATE NOT NULL,
    european_american ENUM('E', 'A') NOT NULL,
    delta DECIMAL(10, 6) NULL,
    gamma DECIMAL(10, 6) NULL,
    theta DECIMAL(10, 6) NULL,
    vega DECIMAL(10, 6) NULL,
    implied_volatility DECIMAL(10, 6) NULL,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_invest_market_underlying_exp (underlying_ticker, expiration_date)
);
