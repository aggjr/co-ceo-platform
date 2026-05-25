-- Referência de custódia capturada no homebroker (por organização e data).
-- Fonte operacional: import JSON (local-import) → apply → livro razão / cotações / âncoras.
-- Sem dados de cliente neste arquivo (somente esquema).

CREATE TABLE IF NOT EXISTS invest_broker_custody_snapshots (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL,
    broker_code VARCHAR(32) NOT NULL DEFAULT 'btg',
    reference_date DATE NOT NULL,
    status ENUM('imported', 'applied', 'superseded') NOT NULL DEFAULT 'imported',
    variable_income DECIMAL(18, 4) NULL,
    fixed_income DECIMAL(18, 4) NULL,
    cash_balance DECIMAL(18, 4) NULL,
    in_transit DECIMAL(18, 4) NULL,
    derivatives DECIMAL(18, 4) NULL,
    total_patrimony DECIMAL(18, 4) NULL,
    source_label VARCHAR(128) NULL,
    notes TEXT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP NULL,
    UNIQUE KEY org_broker_refdate (organization_id, broker_code, reference_date),
    KEY org_status_idx (organization_id, status)
);

CREATE TABLE IF NOT EXISTS invest_broker_custody_snapshot_lines (
    id VARCHAR(96) NOT NULL PRIMARY KEY,
    snapshot_id VARCHAR(64) NOT NULL,
    organization_id VARCHAR(64) NOT NULL,
    ticker VARCHAR(32) NOT NULL,
    line_kind ENUM('mark', 'pending_open', 'pending_topup', 'pending_migrate') NOT NULL,
    quantity DECIMAL(18, 4) NOT NULL,
    last_price DECIMAL(18, 6) NULL,
    market_value DECIMAL(18, 4) NULL,
    avg_price DECIMAL(18, 6) NULL,
    leg_tag VARCHAR(32) NULL,
    KEY snapshot_idx (snapshot_id),
    KEY org_ticker_idx (organization_id, ticker)
);
