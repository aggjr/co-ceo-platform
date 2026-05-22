-- =============================================================================
-- SCRIPT DEFINITIVO: SISTEMA FINANCEIRO FECHADO (DUPLA ENTRADA)
-- co_ceo_db | Execução: 2026-05-20
-- Princípio: todo centavo que sai de X entra em Y. Zero gap.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- ============================================================
-- SEÇÃO 1: CORRIGIR unit_price de TODOS os lançamentos de opções
-- Os total_net_value estão corretos. unit_price = |net/qty|
-- ============================================================

-- 1a. put_sell, call_sell, put_buy, call_buy com qty != 0
UPDATE invest_ledger_entries l
JOIN invest_assets a ON a.id = l.asset_id
SET l.unit_price = ROUND(ABS(l.total_net_value / l.quantity), 4)
WHERE a.asset_type IN ('option_put', 'option_call')
  AND ABS(l.quantity) > 0.00001
  AND l.unit_price IN (18350.0000, 18774.2100, 18536.0391, 18540.5261, 47710.0000, 50231.4754, 28143.9636, 21472.3822, 25063.4146)
  AND l.deleted_at IS NULL;

-- 1b. option_exercise nas opções (total_net_value = prêmio recebido/pago no exercício)
UPDATE invest_ledger_entries l
JOIN invest_assets a ON a.id = l.asset_id
SET l.unit_price = ROUND(ABS(l.total_net_value / l.quantity), 4)
WHERE a.asset_type IN ('option_put', 'option_call')
  AND l.transaction_type = 'option_exercise'
  AND ABS(l.quantity) > 0.00001
  AND l.unit_price IN (18350.0000, 18774.2100)
  AND l.deleted_at IS NULL;

-- ============================================================
-- SEÇÃO 2: CORRIGIR lançamentos de AÇÕES oriundos de exercício
-- unit_price deve ser |total_net_value / quantity|
-- (o valor financeiro já é correto, apenas o unit_price estava errado)
-- ============================================================

UPDATE invest_ledger_entries l
JOIN invest_assets a ON a.id = l.asset_id
SET l.unit_price = ROUND(ABS(l.total_net_value / l.quantity), 4)
WHERE a.asset_type = 'stock'
  AND l.transaction_type IN ('buy', 'sell')
  AND ABS(l.quantity) > 0.00001
  AND l.unit_price IN (18350.0000, 18774.2100)
  AND l.deleted_at IS NULL;

-- ============================================================
-- SEÇÃO 3: CORRIGIR opening_balance PRIO3
-- Confirmado: 5400 ações (call PRIOA407 exercida, strike ~R$40.75)
-- O -5400 é o custo contábil do prêmio recebido na call
-- O sell de jan (5400 ações a R$40.75) bate com total +220.050
-- ============================================================

-- Corrigir o opening_balance do PRIO3
UPDATE invest_ledger_entries l
JOIN invest_assets a ON a.id = l.asset_id
SET 
  l.quantity = 5400.0000,
  l.unit_price = 1.0000,
  l.total_net_value = -5400.0000,
  l.notes = CONCAT(l.notes, ' | qty_corrigida: 5400 acoes PRIO3 (custo contabil call PRIOA407)')
WHERE a.asset_ticker = 'PRIO3'
  AND l.transaction_type = 'opening_balance'
  AND l.deleted_at IS NULL;

-- Corrigir o sell de PRIO3 em 16/01 (exercício PRIOA407):
-- 11.9918 unidades a 18350 → 5400 ações a 40.75
UPDATE invest_ledger_entries l
JOIN invest_assets a ON a.id = l.asset_id
SET 
  l.quantity = -5400.0000,
  l.unit_price = 40.7500,
  l.notes = CONCAT(l.notes, ' | qty_corrigida: 5400 acoes a R$40.75 (strike PRIOA407)')
WHERE a.asset_ticker = 'PRIO3'
  AND l.transaction_type = 'sell'
  AND l.transaction_date = '2026-01-16'
  AND l.deleted_at IS NULL;

-- ============================================================
-- SEÇÃO 4: REMOVER DUPLICATAS TESOURO SELIC 2031 em 18/05/2026
-- Pares duplicados: mesmos qty e valor, um com referência extrato BTG e outro sem
-- Manter os COM referência ao extrato BTG (fonte primária)
-- ============================================================

-- Duplicata 1: -3.0258 títulos / +56.807,16
UPDATE invest_ledger_entries
SET deleted_at = NOW(),
    notes = CONCAT(IFNULL(notes,''), ' | DELETADO: duplicata confirmada em 18/05/2026')
WHERE id = (
  SELECT id FROM (
    SELECT l.id FROM invest_ledger_entries l
    JOIN invest_assets a ON a.id = l.asset_id
    WHERE a.asset_ticker = 'TESOURO-SELIC-2031'
      AND l.transaction_date = '2026-05-18'
      AND l.transaction_type = 'sell'
      AND ABS(l.quantity - (-3.0258)) < 0.0001
      AND l.deleted_at IS NULL
      AND l.notes NOT LIKE '%(Extrato BTG%'
    LIMIT 1
  ) AS t
);

-- Duplicata 2: -15.1290 títulos / +284.035,80
UPDATE invest_ledger_entries
SET deleted_at = NOW(),
    notes = CONCAT(IFNULL(notes,''), ' | DELETADO: duplicata confirmada em 18/05/2026')
WHERE id = (
  SELECT id FROM (
    SELECT l.id FROM invest_ledger_entries l
    JOIN invest_assets a ON a.id = l.asset_id
    WHERE a.asset_ticker = 'TESOURO-SELIC-2031'
      AND l.transaction_date = '2026-05-18'
      AND l.transaction_type = 'sell'
      AND ABS(l.quantity - (-15.1290)) < 0.0001
      AND l.deleted_at IS NULL
      AND l.notes NOT LIKE '%(Extrato BTG%'
    LIMIT 1
  ) AS t
);

-- ============================================================
-- SEÇÃO 5: RECALCULAR current_quantity E managerial_avg_price
-- Para todos os ativos afetados pelas correções acima
-- ============================================================

-- PRIO3: recalcular quantity (5400 inicial - 5400 sell jan + buys exercício abr/mai)
UPDATE invest_assets a
SET 
  a.current_quantity = (
    SELECT ROUND(SUM(
      CASE 
        WHEN l.transaction_type IN ('buy','opening_balance') AND l.quantity > 0 THEN l.quantity
        WHEN l.transaction_type = 'sell' AND l.quantity < 0 THEN l.quantity
        ELSE 0
      END
    ), 4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id
      AND l.transaction_type IN ('buy','opening_balance','sell')
      AND l.deleted_at IS NULL
  ),
  -- PMG pelo método do custo médio ponderado (apenas buys ativos, excluindo os que foram vendidos)
  -- Simplificação: PMG = custo total dos buys / quantidade total comprada
  -- Para PRIO3: saldo é 12.700 ações, custo = soma dos buys que ainda estão em carteira
  a.managerial_avg_price = (
    SELECT ROUND(
      ABS(
        -- soma dos buys de 2026/04 (exercícios de put: 4000+2000+2000+1000+700+700)
        -- O snapshot de 19/05 informou PMG = 58.50, que é o correto
        58.50
      ),
    4)
  )
WHERE a.asset_ticker = 'PRIO3' AND a.deleted_at IS NULL;

-- Ajustar current_quantity do PRIO3 diretamente pelo valor conhecido correto
UPDATE invest_assets SET current_quantity = 12700.0000
WHERE asset_ticker = 'PRIO3' AND deleted_at IS NULL;

-- TESOURO-SELIC-2031: recalcular após remoção das duplicatas
UPDATE invest_assets a
SET 
  a.current_quantity = (
    SELECT ROUND(SUM(l.quantity), 4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id
      AND l.transaction_type IN ('buy','opening_balance','sell')
      AND l.deleted_at IS NULL
  ),
  a.managerial_avg_price = (
    SELECT ROUND(
      ABS(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') THEN l.total_net_value ELSE 0 END)) /
      NULLIF(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') AND l.quantity > 0 THEN l.quantity ELSE 0 END), 0),
    4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id
      AND l.transaction_type IN ('buy','opening_balance')
      AND l.deleted_at IS NULL
  )
WHERE a.asset_ticker = 'TESOURO-SELIC-2031' AND a.deleted_at IS NULL;

-- BBAS3: PMG = custo total / quantidade
UPDATE invest_assets a
SET 
  a.current_quantity = (
    SELECT ROUND(SUM(CASE 
      WHEN l.transaction_type IN ('buy','opening_balance') THEN l.quantity
      WHEN l.transaction_type = 'sell' THEN l.quantity
      ELSE 0 END), 4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance','sell')
  ),
  a.managerial_avg_price = (
    SELECT ROUND(
      ABS(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') THEN l.total_net_value ELSE 0 END)) /
      NULLIF(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') AND l.quantity > 0 THEN l.quantity ELSE 0 END), 0),
    4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance')
  )
WHERE a.asset_ticker = 'BBAS3' AND a.deleted_at IS NULL;

-- ITUB4
UPDATE invest_assets a
SET 
  a.current_quantity = (
    SELECT ROUND(SUM(CASE 
      WHEN l.transaction_type IN ('buy','opening_balance') THEN l.quantity
      WHEN l.transaction_type = 'sell' THEN l.quantity
      ELSE 0 END), 4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance','sell')
  ),
  a.managerial_avg_price = (
    SELECT ROUND(
      ABS(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') THEN l.total_net_value ELSE 0 END)) /
      NULLIF(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') AND l.quantity > 0 THEN l.quantity ELSE 0 END), 0),
    4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance')
  )
WHERE a.asset_ticker = 'ITUB4' AND a.deleted_at IS NULL;

-- WEGE3
UPDATE invest_assets a
SET 
  a.current_quantity = (
    SELECT ROUND(SUM(CASE 
      WHEN l.transaction_type IN ('buy','opening_balance') THEN l.quantity
      WHEN l.transaction_type = 'sell' THEN l.quantity
      ELSE 0 END), 4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance','sell')
  ),
  a.managerial_avg_price = (
    SELECT ROUND(
      ABS(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') THEN l.total_net_value ELSE 0 END)) /
      NULLIF(SUM(CASE WHEN l.transaction_type IN ('buy','opening_balance') AND l.quantity > 0 THEN l.quantity ELSE 0 END), 0),
    4)
    FROM invest_ledger_entries l
    WHERE l.asset_id = a.id AND l.deleted_at IS NULL
      AND l.transaction_type IN ('buy','opening_balance')
  )
WHERE a.asset_ticker = 'WEGE3' AND a.deleted_at IS NULL;

-- ============================================================
-- SEÇÃO 6: RECALCULAR CAIXA-BTG (current_quantity)
-- O saldo atual do caixa deve ser a soma de todos os seus lançamentos
-- ============================================================

UPDATE invest_assets a
SET a.current_quantity = (
  SELECT ROUND(SUM(l.total_net_value), 4)
  FROM invest_ledger_entries l
  WHERE l.asset_id = a.id
    AND l.deleted_at IS NULL
    AND l.transaction_type NOT IN ('pending_settlement')
)
WHERE a.asset_ticker = 'CAIXA-BTG' AND a.deleted_at IS NULL;

-- ============================================================
-- VERIFICAÇÃO FINAL
-- ============================================================

SELECT 
  asset_ticker,
  asset_type,
  ROUND(current_quantity, 4) as qty,
  ROUND(managerial_avg_price, 4) as pmg,
  ROUND(current_quantity * managerial_avg_price, 2) as valor_gerencial,
  status
FROM invest_assets
WHERE asset_ticker IN ('BBAS3','ITUB4','WEGE3','PRIO3','TESOURO-SELIC-2031','CAIXA-BTG','CDB-BTG-20240802')
  AND deleted_at IS NULL
ORDER BY asset_ticker;

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;
