-- ==============================================================================
-- CO-CEO PLATFORM | INVEST MODULE SCHEMA (V2 - ENTERPRISE GRADE)
-- ==============================================================================

-- 1. CUSTÓDIA DE ATIVOS (The "Wallet")
CREATE TABLE invest_assets (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    asset_ticker VARCHAR(20) NOT NULL, -- Ex: 'PRIO3', 'PETR4', 'PICASSO-01'
    asset_type ENUM('stock', 'option_call', 'option_put', 'fii', 'fixed_income', 'alternative', 'artwork', 'real_estate') NOT NULL,
    current_quantity DECIMAL(18, 4) DEFAULT 0,
    managerial_avg_price DECIMAL(18, 4) DEFAULT 0, -- O Santo Graal (Calculado Botton-Up)
    metadata JSON NULL, -- Para armazenar dados dinâmicos de Obras de Arte, Imóveis, etc.
    status ENUM('active', 'liquidated') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL, -- SOFT DELETE
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY org_asset_idx (organization_id, asset_ticker)
);

-- 2. LIVRO-RAZÃO (The "Ledger" - Immutable append-only concept, but with soft-delete for errors)
CREATE TABLE invest_ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_type ENUM('buy', 'sell', 'dividend', 'jcp', 'split', 'bonus', 'option_exercise', 'fee', 'revaluation') NOT NULL,
    quantity DECIMAL(18, 4) NOT NULL, -- Positivo (compra/ganho), Negativo (venda/perda)
    unit_price DECIMAL(18, 4) NOT NULL,
    total_gross_value DECIMAL(18, 4) NOT NULL, -- quantity * unit_price
    brokerage_fee DECIMAL(18, 4) DEFAULT 0,
    b3_fees DECIMAL(18, 4) DEFAULT 0,
    irrf_tax DECIMAL(18, 4) DEFAULT 0,
    total_net_value DECIMAL(18, 4) NOT NULL, -- gross - fees - taxes
    impacts_managerial_price BOOLEAN DEFAULT TRUE, -- Se for FALSE, é apenas registro contábil
    notes VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL, -- SOFT DELETE (Substitui o DELETE físico em caso de erro na boleta)
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (asset_id) REFERENCES invest_assets(id)
);

-- 3. HISTÓRICO DE POSIÇÃO (Snapshots Diários para Curvas Rápidas)
CREATE TABLE invest_daily_snapshots (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    snapshot_date DATE NOT NULL,
    closing_price DECIMAL(18, 4) NOT NULL, -- Preço de mercado no dia
    quantity_held DECIMAL(18, 4) NOT NULL, -- Quantidade no dia
    managerial_avg_price DECIMAL(18, 4) NOT NULL, -- O preço médio naquele dia
    total_market_value DECIMAL(18, 4) NOT NULL, -- closing * qty
    total_managerial_value DECIMAL(18, 4) NOT NULL, -- avg * qty
    unrealized_pnl DECIMAL(18, 4) NOT NULL, -- market - managerial
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (asset_id) REFERENCES invest_assets(id),
    UNIQUE KEY org_asset_date_idx (organization_id, asset_id, snapshot_date)
);

-- 4. CACHE DE OPÇÕES (Scraper da B3/Opcoes.net)
CREATE TABLE invest_options_chain (
    ticker VARCHAR(20) PRIMARY KEY,
    underlying_ticker VARCHAR(20) NOT NULL, -- Ação mãe (ex: PRIO3)
    type ENUM('CALL', 'PUT') NOT NULL,
    strike_price DECIMAL(18, 4) NOT NULL,
    expiration_date DATE NOT NULL,
    european_american ENUM('E', 'A') NOT NULL,
    delta DECIMAL(8, 4) NULL, -- Gregas
    gamma DECIMAL(8, 4) NULL,
    theta DECIMAL(8, 4) NULL,
    vega DECIMAL(8, 4) NULL,
    implied_volatility DECIMAL(8, 4) NULL,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_underlying_exp (underlying_ticker, expiration_date)
);
