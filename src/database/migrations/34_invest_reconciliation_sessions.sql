-- Sessão de conciliação INVEST (notas → extrato, fechamento dia a dia).
-- ver: docs/architecture/invest_reconciliacao_sessao.md §D

CREATE TABLE IF NOT EXISTS invest_reconciliation_sessions (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    phase ENUM('notes', 'cash') NOT NULL,
    status ENUM('in_progress', 'notes_complete', 'cash_complete', 'aborted') NOT NULL DEFAULT 'in_progress',
    horizon_trusted_through DATE NULL,
    file_index JSON NULL,
    progress_by_day JSON NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    INDEX idx_recon_session_org_status (organization_id, status),
    INDEX idx_recon_session_org_phase (organization_id, phase)
);

CREATE TABLE IF NOT EXISTS invest_reconciliation_day_log (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    business_date DATE NOT NULL,
    action ENUM('preview', 'resolve', 'close') NOT NULL,
    inserted INT NOT NULL DEFAULT 0,
    deleted INT NOT NULL DEFAULT 0,
    skipped INT NOT NULL DEFAULT 0,
    user_decisions JSON NULL,
    audit_snapshot JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (session_id) REFERENCES invest_reconciliation_sessions(id) ON DELETE CASCADE,
    INDEX idx_recon_day_log_session (session_id, business_date),
    INDEX idx_recon_day_log_org_date (organization_id, business_date)
);
