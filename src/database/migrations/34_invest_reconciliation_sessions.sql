-- Sessão de conciliação INVEST (notas / extrato, dia a dia).
CREATE TABLE IF NOT EXISTS invest_reconciliation_sessions (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    phase ENUM('notes', 'cash') NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    horizon_trusted_through DATE NULL,
    file_index JSON NULL,
    progress_by_day JSON NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    KEY org_status_idx (organization_id, status)
);

CREATE TABLE IF NOT EXISTS invest_reconciliation_day_log (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    business_date DATE NOT NULL,
    action VARCHAR(16) NOT NULL,
    inserted INT NOT NULL DEFAULT 0,
    deleted INT NOT NULL DEFAULT 0,
    skipped INT NOT NULL DEFAULT 0,
    user_decisions JSON NULL,
    audit_snapshot JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES invest_reconciliation_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    KEY session_date_idx (session_id, business_date)
);
