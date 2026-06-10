-- Migration 47: Persistência de execuções da Opção C (invest_reconcile_runs)
-- Garante que o estado de cada run sobreviva a reinicializações do servidor.

CREATE TABLE IF NOT EXISTS invest_reconcile_runs (
  run_id          VARCHAR(120) NOT NULL PRIMARY KEY,
  organization_id VARCHAR(36)  NOT NULL,
  phase           VARCHAR(30)  NOT NULL DEFAULT 'notes',
  run_status      VARCHAR(20)  NOT NULL DEFAULT 'running',
  run_error       TEXT         NULL,
  state_json      MEDIUMTEXT   NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_irr_org_status (organization_id, run_status),
  INDEX idx_irr_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
