-- Textos de período e colunas INVEST (sem hardcode no frontend)
INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
VALUES
  ('00000000-0000-4003-8000-000000000110', 'label.common.period_from', 'CORE', 'label', 'De', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000111', 'label.common.period_to', 'CORE', 'label', 'Até', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000112', 'action.common.update', 'CORE', 'action', 'Atualizar', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000113', 'action.common.load_template', 'INVEST', 'action', 'Carregar modelo', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000114', 'action.common.import_recalc', 'INVEST', 'action', 'Importar e recalcular', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000115', 'screen.invest.resultado.import_title', 'INVEST', 'screen_title', 'Importar carteira e notas', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000116', 'screen.invest.resultado.import_help', 'INVEST', 'description', 'Cole JSON com opening_date, opening_positions, entries e opcionalmente monthly_statements. O sistema recalcula custódia e o pivot.', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000117', 'column.invest.stock_gain.underlying', 'INVEST', 'column_label', 'Ação', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000118', 'column.invest.stock_gain.preco_estrito', 'INVEST', 'column_label', 'Preço estrito (PM)', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000119', 'column.invest.stock_gain.cotacao_atual', 'INVEST', 'column_label', 'Cotação atual', 'pt-BR')
ON DUPLICATE KEY UPDATE default_text = VALUES(default_text);
