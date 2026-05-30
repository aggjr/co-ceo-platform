-- Âncora de maio/2026 alinhada ao tooltip do app BTG (29/05/2026).

DELETE FROM invest_patrimony_monthly_anchors
WHERE organization_id = 'org-holding-001'
  AND reference_date IN ('2026-05-18', '2026-05-19', '2026-05-22', '2026-05-31');

INSERT IGNORE INTO invest_patrimony_monthly_anchors
    (id, organization_id, reference_date, patrimony, source, notes)
VALUES
    ('ipa-holding-2026-05-29', 'org-holding-001', '2026-05-29', 1450578.2000, 'btg_custody',
     'Fechamento 29/05/2026 (app BTG)');

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1450578.2000,
    notes = 'Fechamento 29/05/2026 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-05-29';

-- Inícios de mês (patrimônio de abertura no app BTG) para interpolação intra-mês correta.
INSERT IGNORE INTO invest_patrimony_monthly_anchors
    (id, organization_id, reference_date, patrimony, source, notes)
VALUES
    ('ipa-holding-2026-01-01', 'org-holding-001', '2026-01-01', 1212435.4100, 'btg_custody_open', 'Abertura jan/2026 (app BTG)'),
    ('ipa-holding-2026-02-01', 'org-holding-001', '2026-02-01', 1320481.6000, 'btg_custody_open', 'Abertura fev/2026 (app BTG)'),
    ('ipa-holding-2026-03-01', 'org-holding-001', '2026-03-01', 1333604.4300, 'btg_custody_open', 'Abertura mar/2026 (app BTG)'),
    ('ipa-holding-2026-04-01', 'org-holding-001', '2026-04-01', 1392272.8600, 'btg_custody_open', 'Abertura abr/2026 (app BTG)'),
    ('ipa-holding-2026-05-01', 'org-holding-001', '2026-05-01', 1478734.3800, 'btg_custody_open', 'Abertura mai/2026 (app BTG)');
