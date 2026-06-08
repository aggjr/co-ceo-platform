-- Migration 46: INVEST book periods / configurable opening

CREATE TABLE IF NOT EXISTS invest_book_periods (
  id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  book_code VARCHAR(40) NOT NULL DEFAULT 'INVEST',
  opening_date DATE NOT NULL,
  opening_source_ref VARCHAR(180) NOT NULL,
  fiscal_year INT NULL,
  status ENUM('active', 'closed', 'archived') NOT NULL DEFAULT 'active',
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invest_book_period_date (organization_id, book_code, opening_date),
  INDEX idx_invest_book_period_default (organization_id, book_code, is_default),
  INDEX idx_invest_book_period_lookup (organization_id, book_code, status, opening_date)
);

INSERT INTO invest_book_periods
  (
    id,
    organization_id,
    book_code,
    opening_date,
    opening_source_ref,
    fiscal_year,
    status,
    is_default
  )
VALUES
  (
    'ibp-holding-invest-2026',
    'org-holding-001',
    'INVEST',
    '2026-01-01',
    'OPENING:2026-01-01',
    2026,
    'active',
    TRUE
  )
ON DUPLICATE KEY UPDATE
  opening_date = VALUES(opening_date),
  opening_source_ref = VALUES(opening_source_ref),
  fiscal_year = VALUES(fiscal_year),
  status = VALUES(status),
  is_default = VALUES(is_default);
