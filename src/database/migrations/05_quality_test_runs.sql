-- Histórico de execuções de regressão (painel Cockpit Qualidade)
CREATE TABLE quality_test_runs (
    id VARCHAR(36) PRIMARY KEY,
    run_mode VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    triggered_by_user_id VARCHAR(36) NOT NULL,
    git_branch VARCHAR(120) NULL,
    git_commit VARCHAR(40) NULL,
    total_tests INT NOT NULL DEFAULT 0,
    passed INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    skipped INT NOT NULL DEFAULT 0,
    coverage_lines_pct DECIMAL(5,2) NULL,
    impact_skipped INT NULL,
    report_json JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_quality_runs_created (created_at DESC)
);
