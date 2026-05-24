-- Fechamentos mensais de patrimônio total (custódia BTG) por organização.
-- Fonte canônica para calibração da curva diária (interpolação entre âncoras).

CREATE TABLE IF NOT EXISTS invest_patrimony_monthly_anchors (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    reference_date DATE NOT NULL,
    patrimony DECIMAL(18, 4) NOT NULL,
    source VARCHAR(64) NOT NULL DEFAULT 'btg_custody',
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY uk_invest_patrimony_anchor_org_date (organization_id, reference_date),
    INDEX idx_invest_patrimony_anchor_org (organization_id)
);

-- Holding demo: capturas BTG/Necton (18–19/05/2026). Idempotente.
INSERT IGNORE INTO invest_patrimony_monthly_anchors
    (id, organization_id, reference_date, patrimony, source, notes)
VALUES
    ('ipa-holding-2025-12-31', 'org-holding-001', '2025-12-31', 1224319.0000, 'btg_custody', 'Fechamento dez/2025'),
    ('ipa-holding-2026-01-31', 'org-holding-001', '2026-01-31', 1324490.0000, 'btg_custody', 'Fechamento jan/2026'),
    ('ipa-holding-2026-02-28', 'org-holding-001', '2026-02-28', 1346751.0000, 'btg_custody', 'Fechamento fev/2026'),
    ('ipa-holding-2026-03-31', 'org-holding-001', '2026-03-31', 1413532.0000, 'btg_custody', 'Fechamento mar/2026'),
    ('ipa-holding-2026-04-30', 'org-holding-001', '2026-04-30', 1513703.0000, 'btg_custody', 'Fechamento abr/2026'),
    ('ipa-holding-2026-05-18', 'org-holding-001', '2026-05-18', 1509811.2600, 'btg_custody', 'Fechamento reprocessado 18/05'),
    ('ipa-holding-2026-05-19', 'org-holding-001', '2026-05-19', 1509811.2600, 'btg_custody', 'Igual 18/05'),
    ('ipa-holding-2026-05-31', 'org-holding-001', '2026-05-31', 1509811.2600, 'btg_custody', 'Projeção até fim do mês'),
    ('ipa-holding-fi-total', 'org-holding-001', '1970-01-01', 208292.9000, 'fixed_income_total', 'RF total nas âncoras BTG (não é fechamento)');
