-- ==============================================================================
-- CO-CEO PLATFORM | Gateway: hodômetro de storage + ledger
-- Executar uma vez após 00_core_saas_schema.sql
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN storage_bytes_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN plan_storage_limit_bytes BIGINT NULL;

CREATE TABLE organization_storage_ledger (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    delta_bytes BIGINT NOT NULL,
    source_table VARCHAR(100) NOT NULL,
    record_id VARCHAR(255) NULL,
    action ENUM('INSERT', 'UPDATE', 'SOFT_DELETE') NOT NULL,
    actor_user_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    INDEX idx_storage_org_created (organization_id, created_at)
);
