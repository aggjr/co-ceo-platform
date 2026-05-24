-- Âncoras de patrimônio alinhadas às capturas do homebroker BTG (mai/2026).

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1212435.4100, notes = 'Fechamento dez/2025 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2025-12-31';

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1320481.6000, notes = 'Fechamento jan/2026 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-01-31';

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1333604.4300, notes = 'Fechamento fev/2026 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-02-28';

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1392272.8600, notes = 'Fechamento mar/2026 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-03-31';

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1478734.3800, notes = 'Fechamento abr/2026 (app BTG)'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-04-30';

UPDATE invest_patrimony_monthly_anchors
SET patrimony = 1505055.5500, notes = 'Patrimônio 22/05/2026 (app BTG)', reference_date = '2026-05-22'
WHERE organization_id = 'org-holding-001' AND reference_date = '2026-05-18';

DELETE FROM invest_patrimony_monthly_anchors
WHERE organization_id = 'org-holding-001' AND reference_date IN ('2026-05-19', '2026-05-31');

INSERT IGNORE INTO invest_patrimony_monthly_anchors
    (id, organization_id, reference_date, patrimony, source, notes)
VALUES
    ('ipa-holding-2026-05-22', 'org-holding-001', '2026-05-22', 1505055.5500, 'btg_custody', 'Patrimônio 22/05/2026 (app BTG)');
