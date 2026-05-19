-- Fechamento diário da carteira (a partir da gravação automática / manual).
CREATE TABLE IF NOT EXISTS invest_portfolio_daily (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    snapshot_date DATE NOT NULL,
    patrimony DECIMAL(18, 4) NOT NULL,
    patrimony_gross DECIMAL(18, 4) NOT NULL,
    cash DECIMAL(18, 4) NOT NULL,
    positions_value DECIMAL(18, 4) NOT NULL,
    pending_settlements DECIMAL(18, 4) DEFAULT 0,
    fixed_income_total DECIMAL(18, 4) DEFAULT 0,
    external_flow DECIMAL(18, 4) DEFAULT 0,
    daily_return_simple DECIMAL(12, 8) NULL,
    daily_return_twr DECIMAL(12, 8) NULL,
    cumulative_twr DECIMAL(12, 8) NULL,
    quotes_as_of DATE NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'mtm_economic',
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY org_snapshot_date_idx (organization_id, snapshot_date)
);
