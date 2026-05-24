-- Execuções de jobs agendados (cron embutido / rotinas da plataforma)
CREATE TABLE platform_scheduled_job_runs (
    id VARCHAR(36) PRIMARY KEY,
    job_key VARCHAR(64) NOT NULL,
    status ENUM('running', 'success', 'warning', 'error') NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    summary_json JSON NULL,
    error_message TEXT NULL,
    host VARCHAR(120) NULL,
    INDEX idx_platform_job_runs_key_started (job_key, started_at DESC),
    INDEX idx_platform_job_runs_status_started (status, started_at DESC)
);

-- Alertas para equipe co-CEO (escopo global) — falhas e avisos de jobs
CREATE TABLE platform_admin_alerts (
    id VARCHAR(36) PRIMARY KEY,
    job_run_id VARCHAR(36) NULL,
    job_key VARCHAR(64) NOT NULL,
    severity ENUM('info', 'warning', 'error') NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP NULL,
    acknowledged_by_user_id VARCHAR(36) NULL,
    INDEX idx_platform_alerts_unread (acknowledged_at, created_at DESC),
    INDEX idx_platform_alerts_job (job_key, created_at DESC)
);
