-- Tela Exposição notional (PUTs / CALLs por vencimento)
INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
VALUES
  ('00000000-0000-4003-8000-000000000183', 'menu.invest.options.exposure', 'INVEST', 'menu_item', 'Exposição', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000184', 'screen.invest.options.exposure.title', 'INVEST', 'screen_title', 'Opções — Exposição', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000185', 'screen.invest.options.exposure.empty', 'INVEST', 'field_label', 'Nenhuma posição neste vencimento.', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000186', 'field.invest.options.exposure.pct_near', 'INVEST', 'field_label', 'Faixa próxima (%)', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000187', 'field.invest.options.exposure.pct_far', 'INVEST', 'field_label', 'Faixa intermediária até (%)', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000188', 'screen.invest.options.exposure.put_title', 'INVEST', 'field_label', 'PUTs — dinheiro possível no exercício', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000189', 'screen.invest.options.exposure.put_help', 'INVEST', 'description', 'Notional por ação: já ITM/ATM, até {pct}% acima do strike e faixa seguinte. Ajuda a estimar necessidade de caixa se o papel subir.', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000190', 'screen.invest.options.exposure.call_title', 'INVEST', 'field_label', 'CALLs — notional por proximidade do strike', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000191', 'screen.invest.options.exposure.call_help', 'INVEST', 'description', 'Mesma lógica das PUTs, espelhada: ITM/ATM e faixas abaixo do strike (até {pct}% e até o limite maior).', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000192', 'column.invest.options.exposure.asset', 'INVEST', 'column_label', 'Ativo', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000193', 'column.invest.options.exposure.itm', 'INVEST', 'column_label', 'Já ITM / ATM', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000194', 'column.invest.options.exposure.band_near_put', 'INVEST', 'column_label', 'Até ~{pct}% acima', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000195', 'column.invest.options.exposure.band_far_put', 'INVEST', 'column_label', 'Entre {pctNear}% e ~{pct}% acima', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000196', 'column.invest.options.exposure.band_near_call', 'INVEST', 'column_label', 'Até ~{pct}% abaixo', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000197', 'column.invest.options.exposure.band_far_call', 'INVEST', 'column_label', 'Entre {pctNear}% e ~{pct}% abaixo', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000198', 'column.invest.options.exposure.total', 'INVEST', 'column_label', 'Notional total', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000199', 'column.invest.options.exposure.total_row', 'INVEST', 'column_label', 'TOTAL', 'pt-BR')
ON DUPLICATE KEY UPDATE default_text = VALUES(default_text);
