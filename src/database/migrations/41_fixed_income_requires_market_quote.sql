-- ============================================================================
-- Migration 41 - renda fixa tambem exige cotacao diaria
-- Corrige ambientes que ja tenham aplicado a migration 40 anterior.
-- ============================================================================

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote = TRUE,
  default_quote_source = 'tesouro_direto',
  valuation_mode = 'market_price'
WHERE module_code = 'INVEST'
  AND subcategory = 'fixed_income';
