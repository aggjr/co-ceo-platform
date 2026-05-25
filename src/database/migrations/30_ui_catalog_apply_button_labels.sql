-- Botão temporário no header: sincronizar catálogo UI (DE-PARA)
INSERT INTO ui_text_catalog (id, text_key, module_code, kind, default_text, locale)
VALUES
  ('00000000-0000-4003-8000-000000000180', 'action.platform.ui_catalog_apply', 'CORE', 'button_label', 'Sincronizar DE-PARA UI', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000181', 'action.platform.ui_catalog_apply.hint', 'CORE', 'description', 'Grava textos curtos do catálogo (Opções Cards, filtros, menu) no MySQL deste ambiente.', 'pt-BR'),
  ('00000000-0000-4003-8000-000000000182', 'action.platform.ui_catalog_apply.done', 'CORE', 'field_label', 'Catálogo UI sincronizado ({texts} textos, {menu} itens de menu). Recarregue a tela se os rótulos não mudarem.', 'pt-BR')
ON DUPLICATE KEY UPDATE default_text = VALUES(default_text);
