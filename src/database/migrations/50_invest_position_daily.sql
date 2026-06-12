-- ==============================================================================
-- CO-CEO PLATFORM | INVEST POSITION DAILY
-- Detalhe diario materializado por posicao/componente financeiro.
-- Sem FK para ativo: o snapshot precisa sobreviver a ativos vencidos, liquidados
-- ou ausentes em tabelas legadas.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS invest_position_daily (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    snapshot_date DATE NOT NULL,
    ticker VARCHAR(32) NOT NULL,
    asset_type VARCHAR(32) NOT NULL,
    account_key VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
    broker_code VARCHAR(32) NULL,
    currency_code VARCHAR(8) NOT NULL DEFAULT 'BRL',
    quantity DECIMAL(20, 6) NOT NULL,
    closing_price DECIMAL(20, 8) NOT NULL,
    total_value DECIMAL(20, 4) NOT NULL,
    managerial_avg_price DECIMAL(20, 8) NULL,
    managerial_value DECIMAL(20, 4) NULL,
    unrealized_pnl DECIMAL(20, 4) NULL,
    price_source VARCHAR(32) NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'mtm_economic',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY uq_invest_position_daily_org_date_ticker_account (
      organization_id, snapshot_date, ticker, asset_type, account_key
    ),
    KEY idx_invest_position_daily_org_date (organization_id, snapshot_date),
    KEY idx_invest_position_daily_ticker_date (ticker, snapshot_date),
    KEY idx_invest_position_daily_source (price_source)
);
