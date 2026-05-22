-- Migration 15: dropa tabelas legadas do INVEST (assets/ledger).
--
-- O nucleo patrimonial (patrimony_items + invest_position_ext +
-- patrimony_ledger_entries + financial_accounts + financial_ledger_entries)
-- e a fonte unica de verdade. Os engines de leitura (CustodyEngine,
-- threePricesEngine, PnLPivotEngine, PatrimonyMtmDailyEngine) consomem o
-- nucleo via LedgerEventProjection.
--
-- Tabelas mantidas (caches/projecoes derivadas, ainda uteis):
--   - invest_portfolio_daily (serie diaria de patrimonio)
--   - invest_daily_snapshots (snapshot historico de cotacoes)
--
-- ATENCAO: irreversivel. Faca backup antes de rodar em producao.

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW IF EXISTS invest_ledger_with_assets;

DROP TABLE IF EXISTS invest_ledger_entries;
DROP TABLE IF EXISTS invest_assets;

SET FOREIGN_KEY_CHECKS = 1;
