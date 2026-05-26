-- kind 'description' para textos de ajuda (ex.: screen.invest.options.exposure.*_help)
ALTER TABLE ui_text_catalog
  MODIFY COLUMN kind ENUM(
    'menu_item',
    'screen_title',
    'column_label',
    'field_label',
    'value_label',
    'button_label',
    'description'
  ) NOT NULL;
