-- ==============================================================================
-- CO-CEO PLATFORM | Telemetria de Uso e Volumetria da Base de Dados
-- ==============================================================================

CREATE TABLE IF NOT EXISTS database_usage_telemetry (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NULL,
    contract_id VARCHAR(36) NULL,
    impersonator_user_id VARCHAR(36) NULL,
    operation_type VARCHAR(50) NOT NULL,
    target_table VARCHAR(100) NULL,
    query_key VARCHAR(100) NULL,
    bytes_in INT NOT NULL DEFAULT 0,
    bytes_out INT NOT NULL DEFAULT 0,
    rows_affected INT NOT NULL DEFAULT 0,
    duration_ms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_db_telemetry_org (organization_id),
    INDEX idx_db_telemetry_user (user_id),
    INDEX idx_db_telemetry_created (created_at)
);
