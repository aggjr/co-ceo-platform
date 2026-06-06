# Plano Arquitetural Definitivo — Módulo INVEST
**Data:** 05/06/2026 | Para execução por múltiplos agentes em sequência

---

## Premissa Central

A fundação já é correta:
- `module_categories` tem `contributes_to_patrimony`, `requires_market_quote`, `default_quote_source`
- `InvestQuoteSyncService` já roteia cotações por `default_quote_source` do banco
- `module_valuation_methods` e `module_settlement_profiles` já existem

**O problema:** `PatrimonyMtmDailyEngine` ignora tudo isso e usa `if (stock || fii)` hardcoded.
**A solução:** fazer o engine ler o banco. Zero novo schema para o problema principal — só seeds SQL e refactor do engine.

---

## Mapa de dependências entre blocos

```
BLOCO A (Schema)
  └─ BLOCO B (Seeds)
       ├─ BLOCO C (Engine)         ← desbloqueado pelos seeds
       ├─ BLOCO D (Quote Providers) ← desbloqueado pelos seeds
       └─ BLOCO E (Parsers)        ← pode rodar em paralelo com C e D

BLOCO F (Fee Schedule)    ← independente, pode rodar a qualquer momento após A
BLOCO G (Event Model)     ← independente, pode rodar a qualquer momento após A
```

---

# BLOCO A — Schema: tabelas faltantes

**Um agente, uma sessão. Execute antes de tudo.**

## Migration 40 — `exchanges`

```sql
-- src/database/migrations/40_exchanges.sql
CREATE TABLE IF NOT EXISTS `exchanges` (
  `id`                 VARCHAR(36)  NOT NULL,
  `code`               VARCHAR(20)  NOT NULL,  -- 'B3', 'NYSE', 'NASDAQ', 'CRYPTO', 'TESOURO'
  `name`               VARCHAR(100) NOT NULL,
  `country_code`       CHAR(2)      NOT NULL,  -- 'BR', 'US'
  `currency_code`      CHAR(3)      NOT NULL,  -- 'BRL', 'USD'
  `timezone`           VARCHAR(50)  NOT NULL,  -- 'America/Sao_Paulo', 'America/New_York'
  `trading_days`       VARCHAR(20)  NOT NULL DEFAULT 'weekdays_minus_holidays',
  -- 'weekdays_minus_holidays' | 'always' (crypto) | 'weekdays_us'
  `settlement_lag_default` TINYINT  NOT NULL DEFAULT 2, -- D+N padrão
  `is_active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exchanges_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Migration 41 — `fee_schedules`

```sql
-- src/database/migrations/41_fee_schedules.sql
CREATE TABLE IF NOT EXISTS `fee_schedules` (
  `id`              VARCHAR(36)    NOT NULL,
  `broker_code`     VARCHAR(20)    NOT NULL,  -- 'BTG', 'XP', 'CLEAR'
  `exchange_code`   VARCHAR(20)    NOT NULL,  -- 'B3', 'NYSE'
  `fee_type`        VARCHAR(40)    NOT NULL,
  -- 'emolumento_b3' | 'taxa_liquidacao_cblc' | 'corretagem' | 'iss'
  -- | 'taxa_registro' | 'taxa_custodia' | 'iof'
  `asset_types`     VARCHAR(200)   NOT NULL DEFAULT '*',
  -- CSV dos subcategorias que se aplicam, ou '*' para todos
  `rate_pct`        DECIMAL(10,6)  NULL,      -- % sobre o valor (ex: 0.003250 = 0.00325%)
  `fixed_amount`    DECIMAL(18,4)  NULL,      -- valor fixo por operação (R$ ou USD)
  `min_amount`      DECIMAL(18,4)  NULL,
  `max_amount`      DECIMAL(18,4)  NULL,
  `valid_from`      DATE           NOT NULL,
  `valid_until`     DATE           NULL,      -- NULL = vigente
  `is_active`       TINYINT(1)     NOT NULL DEFAULT 1,
  `created_at`      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_fee_broker_exchange` (`broker_code`, `exchange_code`, `valid_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Migration 42 — `settlement_contract_rules`

```sql
-- src/database/migrations/42_settlement_contract_rules.sql
-- Substitui D+N hardcoded por regra temporal por corretora/bolsa/tipo de ativo
CREATE TABLE IF NOT EXISTS `settlement_contract_rules` (
  `id`              VARCHAR(36)   NOT NULL,
  `broker_code`     VARCHAR(20)   NOT NULL,
  `exchange_code`   VARCHAR(20)   NOT NULL,
  `asset_type`      VARCHAR(40)   NOT NULL,  -- 'stock' | 'fii' | 'option_call' | '*'
  `operation_type`  VARCHAR(40)   NOT NULL DEFAULT '*', -- 'buy' | 'sell' | '*'
  `settlement_lag`  TINYINT       NOT NULL,  -- dias úteis até D+N
  `calendar_type`   VARCHAR(20)   NOT NULL DEFAULT 'b3_business_days',
  -- 'b3_business_days' | 'us_business_days' | 'calendar_days'
  `valid_from`      DATE          NOT NULL,
  `valid_until`     DATE          NULL,      -- NULL = vigente
  `notes`           VARCHAR(200)  NULL,      -- 'Mudança B3 de D+3 para D+2 em 29/05/2019'
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_settlement_lookup` (`broker_code`, `exchange_code`, `asset_type`, `valid_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Migration 43 — Colunas novas em `module_categories`

```sql
-- src/database/migrations/43_module_categories_exchange_currency.sql
ALTER TABLE `module_categories`
  ADD COLUMN IF NOT EXISTS `exchange_code`  VARCHAR(20) NULL AFTER `default_quote_source`,
  ADD COLUMN IF NOT EXISTS `currency_code`  CHAR(3)     NOT NULL DEFAULT 'BRL' AFTER `exchange_code`,
  ADD COLUMN IF NOT EXISTS `settlement_lag` TINYINT     NULL AFTER `currency_code`,
  -- NULL = usar settlement_contract_rules; valor fixo = override
  ADD COLUMN IF NOT EXISTS `affects_portfolio` TINYINT(1) NOT NULL DEFAULT 1 AFTER `settlement_lag`,
  ADD COLUMN IF NOT EXISTS `affects_financial`  TINYINT(1) NOT NULL DEFAULT 1 AFTER `affects_portfolio`;
```

## Migration 44 — `fx_rates` (câmbio)

```sql
-- src/database/migrations/44_fx_rates.sql
CREATE TABLE IF NOT EXISTS `fx_rates` (
  `id`            VARCHAR(36)    NOT NULL,
  `from_currency` CHAR(3)        NOT NULL,  -- 'USD', 'EUR'
  `to_currency`   CHAR(3)        NOT NULL,  -- 'BRL'
  `rate_date`     DATE           NOT NULL,
  `closing_rate`  DECIMAL(18,6)  NOT NULL,  -- 1 USD = X BRL
  `source`        VARCHAR(20)    NOT NULL,  -- 'ptax', 'yahoo_finance', 'manual'
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fx_rate_date` (`from_currency`, `to_currency`, `rate_date`),
  INDEX `idx_fx_date` (`rate_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Registrar as 3 novas tabelas no `TableRegistry.ts`:**
```typescript
def('exchanges',                   'core',   'global',   { softDelete: false, countsTowardStorage: false }),
def('fee_schedules',               'core',   'global',   { softDelete: false, countsTowardStorage: false }),
def('settlement_contract_rules',   'core',   'global',   { softDelete: false, countsTowardStorage: false }),
def('fx_rates',                    'core',   'global',   { softDelete: false, countsTowardStorage: false }),
```

---

# BLOCO B — Seeds: popular as tabelas

**Um agente, uma sessão. Execute após BLOCO A.**

## Seed exchanges

```sql
-- src/database/seeds/exchanges.sql
INSERT INTO exchanges (id, code, name, country_code, currency_code, timezone, trading_days, settlement_lag_default) VALUES
('ex-b3',      'B3',      'B3 - Brasil Bolsa Balcão',       'BR', 'BRL', 'America/Sao_Paulo',  'weekdays_minus_holidays', 2),
('ex-nyse',    'NYSE',    'New York Stock Exchange',         'US', 'USD', 'America/New_York',   'weekdays_us',             2),
('ex-nasdaq',  'NASDAQ',  'NASDAQ',                          'US', 'USD', 'America/New_York',   'weekdays_us',             2),
('ex-crypto',  'CRYPTO',  'Mercado de Criptomoedas',         'US', 'USD', 'UTC',                'always',                  0),
('ex-tesouro', 'TESOURO', 'Tesouro Nacional Direto',         'BR', 'BRL', 'America/Sao_Paulo',  'weekdays_minus_holidays', 1);
```

## Seed module_categories — novos tipos de ativo

```sql
-- src/database/seeds/module_categories_new_types.sql
-- Adicionar tipos que faltam ao INVEST
INSERT INTO module_categories
  (id, module_code, category, subcategory, label_pt,
   contributes_to_patrimony, requires_market_quote, default_quote_source,
   exchange_code, currency_code, settlement_lag, affects_portfolio, affects_financial)
VALUES
-- ETF B3
('mc-etf-br',     'INVEST', 'investment', 'etf',       'ETF Brasil',
  1, 1, 'brapi',         'B3',      'BRL', 2, 1, 1),
-- BDR (negocia em BRL na B3, preço em BRL)
('mc-bdr',        'INVEST', 'investment', 'bdr',       'BDR',
  1, 1, 'brapi',         'B3',      'BRL', 2, 1, 1),
-- Ação USA (preço em USD, cotação via Yahoo, converter para BRL)
('mc-stock-us',   'INVEST', 'investment', 'stock_us',  'Ação USA',
  1, 1, 'yahoo_finance',  'NYSE',    'USD', 2, 1, 1),
-- ETF USA
('mc-etf-us',     'INVEST', 'investment', 'etf_us',    'ETF USA',
  1, 1, 'yahoo_finance',  'NYSE',    'USD', 2, 1, 1),
-- Crypto
('mc-crypto',     'INVEST', 'investment', 'crypto',    'Criptomoeda',
  1, 1, 'coingecko',      'CRYPTO',  'USD', 0, 1, 0),
-- REIT internacional
('mc-reit',       'INVEST', 'investment', 'reit',      'REIT Internacional',
  1, 1, 'yahoo_finance',  'NYSE',    'USD', 2, 1, 1);
```

## Seed settlement_contract_rules

```sql
-- src/database/seeds/settlement_contract_rules.sql
-- Histórico B3/BTG
INSERT INTO settlement_contract_rules
  (id, broker_code, exchange_code, asset_type, operation_type, settlement_lag,
   calendar_type, valid_from, valid_until, notes)
VALUES
-- B3: D+3 até 28/05/2019
('scr-b3-stock-d3',  'BTG', 'B3', 'stock',       '*', 3, 'b3_business_days', '2000-01-01', '2019-05-28', 'B3 legacy D+3'),
('scr-b3-fii-d3',    'BTG', 'B3', 'fii',         '*', 3, 'b3_business_days', '2000-01-01', '2019-05-28', 'B3 legacy D+3'),
-- B3: D+2 a partir de 29/05/2019
('scr-b3-stock-d2',  'BTG', 'B3', 'stock',       '*', 2, 'b3_business_days', '2019-05-29', NULL, 'B3 D+2 vigente'),
('scr-b3-fii-d2',    'BTG', 'B3', 'fii',         '*', 2, 'b3_business_days', '2019-05-29', NULL, 'B3 D+2 vigente'),
('scr-b3-opt',       'BTG', 'B3', 'option_call', '*', 1, 'b3_business_days', '2000-01-01', NULL, 'Opções D+1'),
('scr-b3-opt-put',   'BTG', 'B3', 'option_put',  '*', 1, 'b3_business_days', '2000-01-01', NULL, 'Opções D+1'),
-- USA
('scr-nyse-stock',   '*',   'NYSE',   'stock_us', '*', 2, 'us_business_days', '2017-09-05', NULL, 'NYSE T+2'),
-- Crypto: liquidação imediata
('scr-crypto',       '*',   'CRYPTO', 'crypto',   '*', 0, 'calendar_days',    '2009-01-03', NULL, 'Crypto D+0');
```

## Seed fee_schedules

```sql
-- src/database/seeds/fee_schedules.sql
INSERT INTO fee_schedules
  (id, broker_code, exchange_code, fee_type, asset_types, rate_pct, fixed_amount, valid_from)
VALUES
('fs-b3-emol-stock',  'BTG', 'B3', 'emolumento_b3',      'stock,fii,etf,bdr', 0.003250, NULL, '2019-01-01'),
('fs-b3-liq-stock',   'BTG', 'B3', 'taxa_liquidacao',     'stock,fii,etf,bdr', 0.020000, NULL, '2019-01-01'),
('fs-b3-emol-opt',    'BTG', 'B3', 'emolumento_b3',       'option_call,option_put', 0.005000, NULL, '2019-01-01'),
('fs-b3-liq-opt',     'BTG', 'B3', 'taxa_liquidacao',     'option_call,option_put', 0.020000, NULL, '2019-01-01'),
('fs-b3-registro',    'BTG', 'B3', 'taxa_registro',       'option_call,option_put', 0.009400, NULL, '2019-01-01');
-- Adicionar mais linhas conforme tabela BTG atual
```

---

# BLOCO C — Engine: usar module_categories

**Um agente, uma sessão. Pré-requisito: BLOCO B concluído.**

## C1 — `AssetValuationContext` (novo arquivo)

**Criar** `src/core/invest/valuation/AssetValuationContext.ts`:

```typescript
import type { CoCeoDataGateway, UserContext } from '../../dal';
import { ModuleCategories } from '../../module-registry';

/**
 * Contexto de valoração carregado do banco UMA vez por dia de reconstrução.
 * Centraliza o que o engine precisa saber sobre cada tipo de ativo SEM hardcode.
 */
export class AssetValuationContext {
  private readonly cats: ModuleCategories;
  private loaded = false;

  // Conjuntos resolvidos do banco — populados por load()
  contributesToPatrimony = new Set<string>();   // subcategories que entram no patrimônio
  requiresMarketQuote    = new Set<string>();   // subcategories que precisam de cotação
  quoteSourceByType      = new Map<string, string>(); // subcategory → fonte
  currencyByType         = new Map<string, string>(); // subcategory → 'BRL' | 'USD'
  exchangeByType         = new Map<string, string>(); // subcategory → 'B3' | 'NYSE' | 'CRYPTO'
  affectsPortfolio       = new Set<string>();   // subcategories que movem posição
  affectsFinancial       = new Set<string>();   // subcategories que movem caixa

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.cats = new ModuleCategories(gateway);
  }

  async load(ctx: UserContext): Promise<void> {
    if (this.loaded) return;
    // Forçar reload completo do catálogo
    this.cats.clearCache();
    await this.cats.ensureLoaded(ctx);

    // Iterar todas as categorias do módulo INVEST
    const investCats = await this.cats.listForModule(ctx, 'INVEST');
    for (const row of investCats) {
      const sub = String(row.subcategory).toLowerCase();

      if (row.contributes_to_patrimony) this.contributesToPatrimony.add(sub);
      if (row.requires_market_quote)    this.requiresMarketQuote.add(sub);
      if (row.default_quote_source)     this.quoteSourceByType.set(sub, String(row.default_quote_source));
      if (row.currency_code)            this.currencyByType.set(sub, String(row.currency_code));
      if (row.exchange_code)            this.exchangeByType.set(sub, String(row.exchange_code));
      if (row.affects_portfolio !== false && row.affects_portfolio !== 0) {
        this.affectsPortfolio.add(sub);
      }
      if (row.affects_financial !== false && row.affects_financial !== 0) {
        this.affectsFinancial.add(sub);
      }
    }
    this.loaded = true;
  }

  isEquityLike(assetType: string): boolean {
    return this.contributesToPatrimony.has(assetType.toLowerCase()) &&
           !this.isFixedIncome(assetType) &&
           !this.isCash(assetType) &&
           !this.isOption(assetType);
  }

  isFixedIncome(assetType: string): boolean {
    const t = assetType.toLowerCase();
    return t === 'fixed_income' || t.startsWith('tesouro') || t.startsWith('cdb') || t.startsWith('lci') || t.startsWith('lca') || t.startsWith('cri') || t.startsWith('cra');
  }

  isOption(assetType: string): boolean {
    const t = assetType.toLowerCase();
    return t === 'option_call' || t === 'option_put';
  }

  isCash(assetType: string): boolean {
    return assetType.toLowerCase() === 'cash';
  }

  needsFxConversion(assetType: string): boolean {
    return (this.currencyByType.get(assetType.toLowerCase()) ?? 'BRL') !== 'BRL';
  }

  getCurrency(assetType: string): string {
    return this.currencyByType.get(assetType.toLowerCase()) ?? 'BRL';
  }
}
```

## C2 — `FxRateRepository` (novo arquivo)

**Criar** `src/core/market/FxRateRepository.ts`:

```typescript
import type { CoCeoDataGateway, UserContext } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';

export class FxRateRepository {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Retorna o último câmbio disponível para uma data.
   * Busca o registro mais recente com rate_date <= asOfDate.
   */
  async getRate(
    fromCurrency: string,
    toCurrency: string,
    asOfDate: string
  ): Promise<number | null> {
    const ctx = authBootstrapContext();
    const rows = await this.gateway.findWhere(ctx, 'fx_rates', {
      from_currency: fromCurrency.toUpperCase(),
      to_currency: toCurrency.toUpperCase(),
    }, {
      extraWhere: 'rate_date <= ?',
      extraParams: [asOfDate],
      orderBy: 'rate_date DESC',
      limit: 1,
    });
    return rows.length ? Number(rows[0]!.closing_rate) : null;
  }

  /**
   * Grava ou atualiza uma taxa de câmbio.
   */
  async upsertRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    closingRate: number,
    source: 'ptax' | 'yahoo_finance' | 'manual'
  ): Promise<void> {
    const ctx = authBootstrapContext();
    const existing = await this.gateway.findWhere(ctx, 'fx_rates', {
      from_currency: fromCurrency.toUpperCase(),
      to_currency:   toCurrency.toUpperCase(),
      rate_date:     rateDate,
    }, { limit: 1 });

    if (existing.length) {
      await this.gateway.update(ctx, 'fx_rates', String(existing[0]!.id), {
        closing_rate: closingRate,
        source,
      });
    } else {
      await this.gateway.insert(ctx, 'fx_rates', {
        from_currency: fromCurrency.toUpperCase(),
        to_currency:   toCurrency.toUpperCase(),
        rate_date:     rateDate,
        closing_rate:  closingRate,
        source,
      });
    }
  }
}
```

## C3 — Refatorar `PatrimonyMtmDailyEngine`

**Regra:** substituir TODA a lógica baseada em `assetType === 'stock' || assetType === 'fii'` por chamadas ao `AssetValuationContext`.

### Mudanças obrigatórias no engine:

**1. Receber `AssetValuationContext` como parâmetro:**

```typescript
// ANTES:
export function buildDailyPatrimonyMtmSeries(
  events: LedgerEvent[],
  from: string,
  to: string,
  options?: PatrimonyMtmOptions
): PatrimonyMtmResult

// DEPOIS:
export async function buildDailyPatrimonyMtmSeries(
  events: LedgerEvent[],
  from: string,
  to: string,
  valuationCtx: AssetValuationContext,    // ← NOVO, carregado pelo caller
  options?: PatrimonyMtmOptions
): Promise<PatrimonyMtmResult>
```

**2. Substituir bloco de valoração hardcoded:**

```typescript
// ANTES — hardcoded:
if (p.assetType === 'stock' || p.assetType === 'fii') {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}

// DEPOIS — orientado por dados:
if (valuationCtx.isEquityLike(p.assetType)) {
  const mark = dailyMark ?? 0;
  // Converter de moeda estrangeira para BRL
  const fxRate = valuationCtx.needsFxConversion(p.assetType)
    ? (fxRates.get(`${valuationCtx.getCurrency(p.assetType)}/BRL`) ?? 1)
    : 1;
  stocksValue += p.qty * mark * fxRate;
}
```

**3. Corrigir `fixedIncomeDynamic`:**

```typescript
// ANTES — bug JavaScript:
const currentFixedIncome = fixedIncomeDynamic || fixedIncome;

// DEPOIS — verificar posições abertas:
const hasOpenFixedIncome = [...positions.values()].some(
  (p) => valuationCtx.isFixedIncome(p.assetType) && Math.abs(p.qty) > 0.0001
);
const currentFixedIncome = hasOpenFixedIncome ? fixedIncomeDynamic : fixedIncome;
```

**4. Carregar FX rates para o período:**

```typescript
// Antes do loop principal, no buildDailyPatrimonyMtmSeries:
const fxRepo = new FxRateRepository(gateway);
const usdBrl = await fxRepo.getRate('USD', 'BRL', to);
const fxRates = new Map<string, number>();
if (usdBrl) fxRates.set('USD/BRL', usdBrl);
```

## C4 — Atualizar `PatrimonyDailyRecorder`

**Arquivo:** `src/core/invest/PatrimonyDailyRecorder.ts`

```typescript
// Injetar AssetValuationContext no constructor
constructor(
  private readonly gateway: CoCeoDataGateway,
  private readonly valuationCtx?: AssetValuationContext  // opcional — cria se não vier
) {}

// Em equityTickersOpenOnDate:
// ANTES:
if (assetType !== 'stock' && assetType !== 'fii') continue;

// DEPOIS:
const ctx = this.valuationCtx ?? await this.loadValuationCtx(userCtx);
if (!ctx.requiresMarketQuote.has(assetType.toLowerCase())) continue;
```

---

# BLOCO D — Quote Providers: CoinGecko e PTAX

**Um agente, uma sessão. Pode rodar em paralelo com BLOCO C após BLOCO B.**

## D1 — `CoinGeckoProvider`

**Criar** `src/core/invest/coinGeckoQuotes.ts`:

```typescript
/**
 * Provedor de cotações de criptomoedas via CoinGecko API v3.
 * 
 * Mapeamento: ticker → coingecko_id
 * Ex: BTC → bitcoin, ETH → ethereum, SOL → solana
 * 
 * Cotações são em USD. A conversão USD→BRL ocorre via FxRateRepository.
 */
const COINGECKO_IDS: Record<string, string> = {
  'BTC':  'bitcoin',
  'ETH':  'ethereum',
  'SOL':  'solana',
  'BNB':  'binancecoin',
  'ADA':  'cardano',
  'DOT':  'polkadot',
  'AVAX': 'avalanche-2',
  'MATIC': 'matic-network',
  'LINK': 'chainlink',
  'UNI':  'uniswap',
};

export type CoinGeckoQuote = {
  ticker: string;
  priceUsd: number;
  asOf: string;
  source: 'coingecko';
};

export async function fetchCoinGeckoQuote(
  ticker: string,
  asOfDate: string
): Promise<CoinGeckoQuote | null> {
  const id = COINGECKO_IDS[ticker.toUpperCase()];
  if (!id) {
    console.warn(`[CoinGecko] ticker não mapeado: ${ticker}`);
    return null;
  }

  // CoinGecko free tier: /coins/{id}/history?date=DD-MM-YYYY
  const [year, month, day] = asOfDate.slice(0, 10).split('-');
  const cgDate = `${day}-${month}-${year}`; // formato CoinGecko

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${cgDate}&localization=false`;
    const headers: Record<string, string> = {};
    if (process.env.COINGECKO_API_KEY) {
      headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;

    const data = await resp.json() as { market_data?: { current_price?: { usd?: number } } };
    const priceUsd = data?.market_data?.current_price?.usd;
    if (!priceUsd) return null;

    return { ticker: ticker.toUpperCase(), priceUsd, asOf: asOfDate, source: 'coingecko' };
  } catch {
    return null;
  }
}

/** Adicionar novo mapeamento em runtime (sem deploy) */
export function registerCoinGeckoId(ticker: string, geckoId: string): void {
  COINGECKO_IDS[ticker.toUpperCase()] = geckoId;
}
```

## D2 — `PtaxFxProvider`

**Criar** `src/core/market/PtaxFxProvider.ts`:

```typescript
/**
 * Provedor de taxa de câmbio USD/BRL via PTAX (Banco Central do Brasil).
 * Endpoint: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/
 */
export async function fetchPtaxUsdBrl(date: string): Promise<number | null> {
  // PTAX retorna data no formato MM-DD-YYYY
  const [year, month, day] = date.slice(0, 10).split('-');
  const ptaxDate = `${month}-${day}-${year}`;

  try {
    const url =
      `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
      `CotacaoDolarDia(dataCotacao='${ptaxDate}')?` +
      `%24format=json&%24select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;

    const data = await resp.json() as { value?: Array<{ cotacaoCompra: number; cotacaoVenda: number }> };
    const row = data?.value?.[0];
    if (!row) return null;

    // Usar média entre compra e venda
    return Math.round(((row.cotacaoCompra + row.cotacaoVenda) / 2) * 10000) / 10000;
  } catch {
    return null;
  }
}
```

## D3 — Adicionar handlers em `InvestQuoteSyncService`

**Arquivo:** `src/core/invest/InvestQuoteSyncService.ts`

No método `fetchQuotesForSource`, adicionar o handler `coingecko` (hoje só tem `brapi` e `yahoo_finance`):

```typescript
if (source === 'coingecko') {
  const { fetchCoinGeckoQuote } = await import('./coinGeckoQuotes');
  const fxRepo = new FxRateRepository(this.gateway);
  const out: QuoteSyncQuote[] = [];
  if (!asOfDate) return out;

  for (const ticker of tickers) {
    const q = await fetchCoinGeckoQuote(ticker, asOfDate).catch(() => null);
    if (!q) continue;

    // Converter USD → BRL usando PTAX
    const usdBrl = await fxRepo.getRate('USD', 'BRL', asOfDate) ?? 1;
    const priceBrl = Math.round(q.priceUsd * usdBrl * 100) / 100;

    out.push({
      ticker: q.ticker,
      price: priceBrl,       // ← armazenar SEMPRE em BRL
      asOf: q.asOf,
      source: 'coingecko',
      kind: 'crypto_close',
      provider: 'coingecko',
    });
  }
  return out;
}
```

## D4 — Sync diário de PTAX

**No** `DailyCloseMaterializeService.syncQuotesForDate`, adicionar:

```typescript
// Após sincronizar cotações de ações, sincronizar PTAX
const { fetchPtaxUsdBrl } = await import('../market/PtaxFxProvider');
const fxRepo = new FxRateRepository(this.gateway);
const usdBrl = await fetchPtaxUsdBrl(date).catch(() => null);
if (usdBrl) {
  await fxRepo.upsertRate('USD', 'BRL', date, usdBrl, 'ptax');
}
```

---

# BLOCO E — Abstração de Parsers (multi-corretora)

**Um agente, uma sessão. Pode rodar em paralelo com C e D.**

## E1 — `IBrokerExtractParser` (interface)

**Criar** `src/core/invest/parsers/IBrokerExtractParser.ts`:

```typescript
import type { UserContext } from '../../dal';

/**
 * Contrato que todo parser de extrato/nota de corretora deve implementar.
 * O parser recebe o arquivo bruto e produz eventos de negócio normalizados.
 * NÃO conhece gateway, NÃO faz escrita em banco — só transforma.
 */
export interface ParsedBrokerEvent {
  sourceRef:      string;         // ex: 'BTG-NOTA-123456' ou 'XP-EXT-2026-01'
  eventKind:      string;         // 'buy' | 'sell' | 'dividend' | 'liq_bolsa' | ...
  occurredOn:     string;         // YYYY-MM-DD
  settlesOn:      string;         // YYYY-MM-DD (D+N calculado)
  ticker:         string;
  assetType:      string;         // 'stock' | 'option_call' | 'crypto' | ...
  underlyingTicker?: string;
  quantity:       number;         // positivo = compra/crédito; negativo = venda/débito
  unitPrice:      number;
  totalNetValue:  number;         // valor líquido (já deduzidas taxas)
  currency:       string;         // 'BRL' | 'USD'
  brokerageRef?:  string;
  notes?:         string;
  rawLine?:       string;         // linha original para auditoria
}

export interface BrokerParseResult {
  events:   ParsedBrokerEvent[];
  warnings: string[];             // itens não reconhecidos (não erros fatais)
  source:   string;               // 'BTG_NOTE_V2' | 'XP_EXTRACT_V1' | ...
}

export interface IBrokerExtractParser {
  readonly brokerCode: string;    // 'BTG' | 'XP' | 'CLEAR'
  readonly parserVersion: string; // 'v2' | 'v1'

  /**
   * Testa se este parser consegue processar o arquivo fornecido.
   * Implementação leve — apenas inspeciona cabeçalho/estrutura.
   */
  canParse(rawContent: string): boolean;

  /**
   * Processa o arquivo e retorna eventos normalizados.
   * Puro — sem side effects, sem I/O de banco.
   */
  parse(rawContent: string, meta?: { filename?: string }): BrokerParseResult;
}
```

## E2 — `BrokerParserRegistry`

**Criar** `src/core/invest/parsers/BrokerParserRegistry.ts`:

```typescript
import type { IBrokerExtractParser, BrokerParseResult } from './IBrokerExtractParser';
import { GatewayError } from '../../dal/errors';

/**
 * Registry de parsers de corretora.
 * Detecta automaticamente qual parser usar baseado no conteúdo do arquivo.
 * Extensível: registrar novos parsers sem alterar código existente.
 */
export class BrokerParserRegistry {
  private readonly parsers: IBrokerExtractParser[] = [];

  register(parser: IBrokerExtractParser): void {
    this.parsers.push(parser);
  }

  /**
   * Detecta o parser correto e processa o arquivo.
   * Tenta todos os parsers em ordem de registro.
   */
  parse(rawContent: string, meta?: { filename?: string }): BrokerParseResult {
    for (const parser of this.parsers) {
      if (parser.canParse(rawContent)) {
        return parser.parse(rawContent, meta);
      }
    }
    throw new GatewayError(
      'UNSUPPORTED_BROKER_FORMAT',
      `Nenhum parser reconheceu o formato do arquivo${meta?.filename ? `: ${meta.filename}` : ''}. ` +
      `Parsers registrados: ${this.parsers.map((p) => `${p.brokerCode}/${p.parserVersion}`).join(', ')}`,
      400
    );
  }

  listParsers(): Array<{ brokerCode: string; parserVersion: string }> {
    return this.parsers.map((p) => ({
      brokerCode: p.brokerCode,
      parserVersion: p.parserVersion,
    }));
  }
}

/** Singleton da aplicação — registrar parsers no bootstrap */
export const brokerParserRegistry = new BrokerParserRegistry();
```

## E3 — Adaptar BTG como implementação da interface

**Criar** `src/core/invest/parsers/BtgBrokerageNoteParser.ts` (wrapper):

```typescript
import type { IBrokerExtractParser, BrokerParseResult } from './IBrokerExtractParser';
import { btgBrokerageNoteParser } from '../btgBrokerageNoteParser'; // parser existente

export class BtgBrokerageNoteParserAdapter implements IBrokerExtractParser {
  readonly brokerCode = 'BTG';
  readonly parserVersion = 'v2';

  canParse(rawContent: string): boolean {
    return rawContent.includes('BTG PACTUAL') ||
           rawContent.includes('Nota de Corretagem') ||
           rawContent.includes('BTG Pactual S.A');
  }

  parse(rawContent: string, meta?: { filename?: string }): BrokerParseResult {
    // Chamar parser existente e mapear para o formato normalizado
    const result = btgBrokerageNoteParser.parse(rawContent);
    return {
      events: result.lines.map((line) => ({
        sourceRef:      `BTG-NOTA-${result.noteNumber}-L${line.lineIndex}`,
        eventKind:      line.operation,
        occurredOn:     line.pregaoDate,
        settlesOn:      line.settlementDate,
        ticker:         line.ticker,
        assetType:      line.assetType,
        underlyingTicker: line.underlying,
        quantity:       line.quantity,
        unitPrice:      line.unitPrice,
        totalNetValue:  line.totalNetValue,
        currency:       'BRL',
        brokerageRef:   `BTG-NOTA-${result.noteNumber}`,
        rawLine:        line.rawText,
      })),
      warnings: result.warnings ?? [],
      source:   'BTG_NOTE_V2',
    };
  }
}
```

**Registrar no bootstrap** (`src/index.ts` ou `src/config/bootstrap.ts`):

```typescript
import { brokerParserRegistry } from './core/invest/parsers/BrokerParserRegistry';
import { BtgBrokerageNoteParserAdapter } from './core/invest/parsers/BtgBrokerageNoteParser';
import { BtgExtractParserAdapter } from './core/invest/parsers/BtgExtractParser';

brokerParserRegistry.register(new BtgBrokerageNoteParserAdapter());
brokerParserRegistry.register(new BtgExtractParserAdapter());
```

---

# BLOCO F — Settlement Calendar orientado por dados

**Um agente, uma sessão. Pode rodar após BLOCO B.**

## F1 — `SettlementRulesService`

**Criar** `src/core/invest/SettlementRulesService.ts`:

```typescript
import type { CoCeoDataGateway } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';

/**
 * Resolve D+N para um trade usando a tabela settlement_contract_rules.
 * Elimina o D+N hardcoded do settlementCalendar.ts.
 */
export class SettlementRulesService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Calcula a data de liquidação para um trade.
   * @param assetType   'stock' | 'fii' | 'option_call' | ...
   * @param tradeDate   data do pregão YYYY-MM-DD
   * @param brokerCode  'BTG' | 'XP' (default: 'BTG')
   */
  async resolveSettlementDate(
    assetType: string,
    tradeDate: string,
    brokerCode = 'BTG'
  ): Promise<string> {
    const ctx = authBootstrapContext();

    // Buscar regra mais específica vigente nesta data
    const rules = await this.gateway.findWhere(ctx, 'settlement_contract_rules', {
      broker_code: brokerCode,
    }, {
      extraWhere:
        '(asset_type = ? OR asset_type = ?) AND valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?)',
      extraParams: [assetType, '*', tradeDate, tradeDate],
      orderBy: 'asset_type DESC, valid_from DESC', // mais específico primeiro
      limit: 1,
    });

    const lag = rules.length ? Number(rules[0]!.settlement_lag) : 2; // padrão D+2
    const calendarType = rules.length ? String(rules[0]!.calendar_type) : 'b3_business_days';

    return this.addBusinessDays(tradeDate, lag, calendarType);
  }

  private addBusinessDays(
    dateStr: string,
    days: number,
    calendarType: string
  ): string {
    if (days === 0) return dateStr;

    const date = new Date(dateStr + 'T12:00:00Z');
    let added = 0;

    while (added < days) {
      date.setUTCDate(date.getUTCDate() + 1);
      const dow = date.getUTCDay();

      if (calendarType === 'calendar_days') {
        added++;
      } else if (dow !== 0 && dow !== 6) {
        // Weekdays only (sem feriados por ora — feriados como evolução futura)
        added++;
      }
    }

    return date.toISOString().slice(0, 10);
  }
}
```

**Atualizar `settlementCalendar.ts`** para usar `SettlementRulesService` em vez de D+2 hardcoded:

```typescript
// ANTES:
export function getSettlementDate(tradeDate: string, assetType: string): string {
  const lag = assetType.startsWith('option') ? 1 : 2; // ← hardcoded
  return addBusinessDays(tradeDate, lag);
}

// DEPOIS:
// settlementCalendar.ts vira um wrapper async
export async function getSettlementDate(
  gateway: CoCeoDataGateway,
  tradeDate: string,
  assetType: string,
  brokerCode = 'BTG'
): Promise<string> {
  const service = new SettlementRulesService(gateway);
  return service.resolveSettlementDate(assetType, tradeDate, brokerCode);
}
```

---

# BLOCO G — Modelo de Eventos: affects_portfolio / affects_financial

**Um agente, uma sessão. Pode rodar após BLOCO B.**

## G1 — Usar `affects_portfolio` e `affects_financial` no processamento

**Arquivo:** `src/core/invest/btgUploadImportService.ts`

Antes de gravar qualquer perna, consultar o `AssetValuationContext`:

```typescript
// Em applyBtgBrokerageUpload e applyBtgExtractUpload:
const valuationCtx = new AssetValuationContext(ledger.gateway);
await valuationCtx.load(ctx);

for (const event of parsedEvents) {
  const affectsPortfolio = valuationCtx.affectsPortfolio.has(event.eventKind.toLowerCase())
                        || valuationCtx.affectsPortfolio.has(event.assetType.toLowerCase());
  const affectsFinancial = valuationCtx.affectsFinancial.has(event.eventKind.toLowerCase())
                        || valuationCtx.affectsFinancial.has(event.assetType.toLowerCase());

  // Perna patrimonial — só se affects_portfolio
  if (affectsPortfolio) {
    await inventoryLedger.recordMovement(ctx, {
      ...event,
      businessEventId: eventId,
    });
  }

  // Perna financeira — só se affects_financial
  if (affectsFinancial) {
    await financialLedger.record(ctx, {
      ...event,
      businessEventId: eventId,
      status: 'pending', // extrato confirma via LIQ BOLSA
    });
  }
}
```

Isso elimina todos os `if (type === 'dividend') { skip financial ... }` espalhados nos parsers.

---

# Sequência de execução pelos agentes

| Bloco | Dependência | Pode paralelizar |
|---|---|---|
| A — Schema (migrations) | Nenhuma | Não |
| B — Seeds SQL | A | Não |
| C — Engine refactor | B | Sim (com D, E, F, G) |
| D — Quote Providers | B | Sim |
| E — Parser abstraction | B | Sim |
| F — Settlement Calendar | B | Sim |
| G — Event model | B | Sim |

---

# Definition of Done Global

- [ ] `exchanges` table populada com B3, NYSE, NASDAQ, CRYPTO, TESOURO
- [ ] `settlement_contract_rules` com histórico D+3 → D+2 da B3
- [ ] `fee_schedules` com emolumentos B3 vigentes
- [ ] `module_categories` com stock_us, crypto, bdr, etf e colunas exchange_code/currency_code
- [ ] `AssetValuationContext` carrega do banco — zero `if (assetType === 'stock')` no engine
- [ ] `PatrimonyMtmDailyEngine` usa `valuationCtx.isEquityLike()` e converte FX
- [ ] `fixedIncomeDynamic` verifica posições abertas antes de usar fallback
- [ ] `FxRateRepository` com PTAX gravado diariamente
- [ ] `CoinGeckoProvider` para crypto com preços em BRL
- [ ] `IBrokerExtractParser` interface com BTG adaptado
- [ ] `BrokerParserRegistry` singleton com parsers registrados no bootstrap
- [ ] `SettlementRulesService` resolve D+N do banco — zero hardcode
- [ ] `affects_portfolio`/`affects_financial` controlam quais pernas são gravadas
- [ ] `npm run build` sem erros / `npm test` sem regressões
- [ ] US stocks com `stock_us` aparecem no patrimônio após sync Yahoo
- [ ] Crypto com `crypto` aparecem no patrimônio após sync CoinGecko
- [ ] Patrimônio em dia com AAPL/BTC != 0 (verificar com rebuild)
