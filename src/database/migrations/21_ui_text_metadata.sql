-- Metadata JSON em textos (cor, cssClass, cssVar) — override parcial por organizacao.
ALTER TABLE ui_text_catalog
  ADD COLUMN metadata JSON NULL AFTER default_text;

ALTER TABLE ui_text_overrides
  ADD COLUMN metadata JSON NULL AFTER text;
