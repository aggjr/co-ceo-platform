-- ============================================================
-- Migration 43: Modulo INVEST — tabelas de configuracao (zero-hardcode)
-- Substitui Sets hardcoded do engine por configuracao via banco.
-- ============================================================

-- T1.1: Classificacao de tipos de ativo para o engine de precos.
-- Para adicionar novo tipo de ativo: INSERT nesta tabela, nunca no codigo.
CREATE TABLE IF NOT EXISTS invest_asset_type_config (
  asset_type        TEXT PRIMARY KEY,
  is_stock_like     INTEGER NOT NULL DEFAULT 0,  -- 1 = acumula PM (acao/FII/ETF/BDR)
  is_option_like    INTEGER NOT NULL DEFAULT 0,  -- 1 = eh opcao negociada
  is_ignored_for_pm INTEGER NOT NULL DEFAULT 0,  -- 1 = ignorado no engine de PM
  description       TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1
);

-- T1.2: Tipos de transacao que nao afetam calculo de PM.
-- Substitui o Set IGNORED_TX hardcoded no engine.
CREATE TABLE IF NOT EXISTS invest_ignored_tx_config (
  operation_type TEXT PRIMARY KEY,
  reason         TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1
);

-- T1.3: Regras de importacao do parser por corretora.
-- Esta tabela ja foi registrada no TableRegistry pelo branch atual.
-- Apenas garantir que o schema exista.
CREATE TABLE IF NOT EXISTS invest_import_rules (
  rule_code           TEXT NOT NULL,
  broker_id           TEXT NOT NULL,          -- 'BTG', 'XP', '*' (todos)
  description_pattern TEXT NOT NULL,          -- regex JavaScript
  mapped_operation    TEXT NOT NULL,          -- ex: 'amortization', 'fee', 'skip'
  target_asset_type   TEXT,                   -- ex: 'fii' (opcional)
  applies_to_b3       INTEGER DEFAULT 0,      -- 1 = custo tambem sobe PM B3
  priority            INTEGER NOT NULL DEFAULT 100,
  description         TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (rule_code, broker_id)
);

-- ============================================================
-- SEEDS: invest_asset_type_config
-- INSERT OR IGNORE: migration pode ser reexecutada com seguranca.
-- ============================================================
INSERT OR IGNORE INTO invest_asset_type_config VALUES
  ('stock',        1, 0, 0, 'Acao B3', 1),
  ('fii',          1, 0, 0, 'Fundo Imobiliario (FII)', 1),
  ('etf',          1, 0, 0, 'ETF (fundo passivo)', 1),
  ('bdr',          1, 0, 0, 'BDR (recibo de acao exterior)', 1),
  ('stock_us',     1, 0, 0, 'Acao nos EUA', 1),
  ('option_call',  0, 1, 0, 'Opcao de Compra (CALL)', 1),
  ('option_put',   0, 1, 0, 'Opcao de Venda (PUT)', 1),
  ('cash',         0, 0, 1, 'Caixa / Conta corrente', 1),
  ('fixed_income', 0, 0, 1, 'Renda fixa (ignorada no PM)', 1);

-- ============================================================
-- SEEDS: invest_ignored_tx_config
-- ============================================================
INSERT OR IGNORE INTO invest_ignored_tx_config VALUES
  ('dividend',           'Proventos nao alteram PM', 1),
  ('jcp',                'JCP nao altera PM', 1),
  ('cash_yield',         'Rendimento de caixa', 1),
  ('securities_lending', 'Locacao de acoes', 1),
  ('capital_deposit',    'Aporte de capital', 1),
  ('capital_withdrawal', 'Retirada de capital', 1),
  ('penalty_b3',         'Multa B3', 1),
  ('fee',                'Taxa generica (fluxo financeiro)', 1),
  ('revaluation',        'Reavaliacao contabil', 1),
  ('pending_settlement', 'Liquidacao futura pendente', 1);

-- ============================================================
-- SEEDS: invest_import_rules — regras do extrato BTG
-- priority: menor numero = maior prioridade (avaliado primeiro)
-- ============================================================
INSERT OR IGNORE INTO invest_import_rules VALUES
  ('BTG_AMORT_FII',  'BTG',
   'AMORT(IZACAO|IZACAO|\.)?|REND\/AMORT',
   'amortization', 'fii', 0, 10,
   'Amortizacao de FII (retorno de capital — reduz PM)', 1),

  ('BTG_LIQ_BOLSA',  'BTG',
   'LIQ\s+BOLSA',
   'skip', NULL, 0, 20,
   'Liquidacao agregada de bolsa — detalhe vem da nota de corretagem', 1),

  ('BTG_IOF',        'BTG',
   '\bIOF\b',
   'fee', NULL, 0, 30,
   'IOF cobrado pelo BTG', 1),

  ('BTG_IRRF_RF',    'BTG',
   'IRRF|I\.R\.R\.F',
   'cost_adjustment', NULL, 0, 40,
   'IRRF retido em renda fixa (applies_to_b3=false por padrao)', 1),

  ('BTG_APORTE',     'BTG',
   'APORTE|TED\s+RECEBIDA|CREDITO\s+EM\s+CONTA',
   'capital_deposit', 'cash', 0, 50,
   'Aporte de capital via TED/DOC', 1),

  ('BTG_RETIRADA',   'BTG',
   'RESGATE|RETIRADA|DEBITO\s+EM\s+CONTA',
   'capital_withdrawal', 'cash', 0, 60,
   'Retirada de capital', 1),

  ('BTG_REND_CAIXA', 'BTG',
   'RENDIMENTO|JUROS\s+(SOBRE\s+)?CAIXA',
   'cash_yield', 'cash', 0, 70,
   'Rendimento sobre caixa em conta corrente', 1),

  ('BTG_DIVIDENDO',  'BTG',
   'DIVIDENDO',
   'dividend', NULL, 0, 80,
   'Dividendo de acao ou FII', 1),

  ('BTG_JCP',        'BTG',
   'JUROS\s+(SOBRE\s+)?CAPITAL\s+PROPRIO|JCP',
   'jcp', NULL, 0, 90,
   'Juros sobre Capital Proprio', 1),

  ('BTG_LOCACAO',    'BTG',
   'LOCACAO|ALUGUEL\s+(DE\s+)?ACOES',
   'securities_lending', NULL, 0, 100,
   'Locacao de acoes (aluguel)', 1);
