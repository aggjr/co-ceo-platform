-- Tela Auditoria Geral — matriz diária patrimônio / caixa / posições
INSERT INTO access_resources (id, resource_key, resource_type, module_code, label, description)
SELECT
  '00000000-0000-4002-8000-000000000013',
  'screen.invest.auditoria_geral',
  'screen',
  'invest',
  'Auditoria Geral',
  'Matriz diária — patrimônio, caixa, trânsito e posições'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM access_resources WHERE resource_key = 'screen.invest.auditoria_geral'
);

INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
SELECT '00000000-0000-4003-8000-000000000200', 'menu.invest.auditoria_geral', 'INVEST', 'menu_item', 'Auditoria Geral', 'pt-BR'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_text_catalog WHERE text_key = 'menu.invest.auditoria_geral');

INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
SELECT '00000000-0000-4003-8000-000000000201', 'screen.invest.auditoria_geral.title', 'INVEST', 'screen_title', 'Auditoria Geral', 'pt-BR'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_text_catalog WHERE text_key = 'screen.invest.auditoria_geral.title');

INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
SELECT '00000000-0000-4003-8000-000000000202', 'screen.invest.auditoria_geral.legend', 'INVEST', 'description', 'Células douradas: valor alterou em relação ao dia útil anterior (compra, venda, liquidação ou movimento de caixa).', 'pt-BR'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_text_catalog WHERE text_key = 'screen.invest.auditoria_geral.legend');

INSERT INTO ui_menu_nodes (
  id, code, parent_id, module_code, path, icon, order_index,
  text_key, access_resource_key, visibility, is_active
)
SELECT
  '00000000-0000-4004-8000-000000000071',
  'invest.auditoria_geral',
  (SELECT id FROM ui_menu_nodes WHERE code = 'invest' LIMIT 1),
  'INVEST',
  '/invest/auditoria-geral',
  NULL,
  66,
  'menu.invest.auditoria_geral',
  'screen.invest.auditoria_geral',
  'all',
  TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ui_menu_nodes WHERE code = 'invest.auditoria_geral');
