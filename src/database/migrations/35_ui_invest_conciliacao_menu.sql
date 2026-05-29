-- Menu Conciliação visível para quem já acessa Resultado histórico (screen.invest.results)
INSERT INTO access_resources (id, resource_key, resource_type, module_code, label, description)
SELECT
  '00000000-0000-4002-8000-000000000012',
  'screen.invest.conciliacao',
  'screen',
  'invest',
  'Conciliação',
  'Wizard notas e extrato — dia a dia'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM access_resources WHERE resource_key = 'screen.invest.conciliacao'
);

INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text)
SELECT '00000000-0000-4003-8000-000000000170', 'menu.invest.conciliacao', 'INVEST', 'menu_item', 'Conciliação'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_text_catalog WHERE text_key = 'menu.invest.conciliacao');

INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text)
SELECT '00000000-0000-4003-8000-000000000110', 'screen.invest.conciliacao.title', 'INVEST', 'screen_title', 'Conciliação'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_text_catalog WHERE text_key = 'screen.invest.conciliacao.title');

INSERT INTO ui_menu_nodes (
  id, code, parent_id, module_code, path, icon, order_index,
  text_key, access_resource_key, visibility, is_active
)
SELECT
  '00000000-0000-4004-8000-000000000070',
  'invest.conciliacao',
  (SELECT id FROM ui_menu_nodes WHERE code = 'invest' LIMIT 1),
  'INVEST',
  '/invest/conciliacao',
  NULL,
  65,
  'menu.invest.conciliacao',
  'screen.invest.results',
  'all',
  TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_menu_nodes WHERE code = 'invest.conciliacao');

UPDATE ui_menu_nodes
SET
  access_resource_key = 'screen.invest.results',
  path = '/invest/conciliacao',
  is_active = TRUE,
  order_index = 65
WHERE code = 'invest.conciliacao';
