# Correção Arquitetural — Patrimônio Diário e Cotações
> Autor: revisão arquitetural  
> Data: 2026-06-05  
> Substitui: `ANALISE_PATRIMONIO_DIARIO_BUGS.md` (tarefas P1–P4 rejeitadas)  
> Status: **documento mestre — ler antes de qualquer alteração nos engines**

---

## Por que as Tasks P1–P4 do documento anterior estão ERRADAS

O documento `ANALISE_PATRIMONIO_DIARIO_BUGS.md` propõe corrigir os bugs expandindo
conjuntos hardcoded:

```typescript
// PROPOSTA REJEITADA — troca um Set errado por um Set "menos errado"
const EQUITY_LIKE_TYPES = new Set([
  'stock', 'fii', 'etf', 'stock_us', 'etf_us', 'bdr', 'crypto', 'reit',
]);
```

Isso viola a regra **#7 do `nucleo_patrimonial.md`**:

> `module_categories` **é dado, não código.**
> Adicionar uma nova subcategoria é seed/migration, nunca string hardcoded em service.

O problema não é o tamanho do `Set`. É a **existência** do `Set` em código.
Amanhã, quando STOCKSPIN precisar incluir SKUs no patrimônio, ou quando REAL_ESTATE
precisar incluir imóveis, o código voltará a estar errado — e ninguém vai lembrar
de atualizar todos os `Set`s espalhados pelo projeto.

**A regra é simples:** se a pergunta é "este tipo de ativo faz X?", a resposta
deve vir do banco — da tabela `module_categories` — não de um `if` ou `Set` em código.

---

## Solução correta — três colunas em `module_categories`

A tabela `module_categories` já é o catálogo de "o que cada subcategoria é e pode fazer".
Ela já carrega `default_valuation_method` e `default_settlement_profile`.
Precisamos adicionar três colunas que respondem às perguntas que os engines fazem:

| Coluna | Responde | Substitui |
|---|---|---|
| `contributes_to_patrimony` | "Este subcategory entra no cálculo de patrimônio diário?" | `EQUITY_LIKE_TYPES` hardcoded |
| `requires_market_quote` | "Precisa de cotação de mercado para ser valorado?" | Guard hardcoded no Recorder |
| `default_quote_source` | "Qual provedor busca a cotação deste tipo de ativo?" | Roteamento hardcoded no SyncService |

Mais uma tabela nova para registrar os provedores disponíveis:

| Tabela | Papel |
|---|---|
| `module_quote_sources` | Catálogo de provedores de cotação. Cada linha = um adaptador implementado em TS |

---

## Parte 1 — Migration SQL

**Arquivo:** `src/database/migrations/36_module_categories_patrimony_and_quotes.sql`

```sql
-- ============================================================
-- Migration 36 — module_categories: patrimônio e cotações
-- Adiciona flags que eliminam hardcode nos engines de patrimônio
-- ============================================================

-- 1. Novas colunas em module_categories
ALTER TABLE module_categories
  ADD COLUMN contributes_to_patrimony  BOOLEAN     NOT NULL DEFAULT FALSE
    COMMENT 'TRUE = este subcategory soma ao patrimônio econômico diário',
  ADD COLUMN requires_market_quote     BOOLEAN     NOT NULL DEFAULT FALSE
    COMMENT 'TRUE = precisa de cotação de mercado para valoração (não calculado)',
  ADD COLUMN default_quote_source      VARCHAR(50) NULL
    COMMENT 'FK lógica para module_quote_sources.source_code';

-- 2. Tabela de provedores de cotação
CREATE TABLE IF NOT EXISTS module_quote_sources (
  source_code           VARCHAR(50)  NOT NULL,
  description           VARCHAR(255) NOT NULL,
  base_currency         VARCHAR(10)  NOT NULL DEFAULT 'BRL',
  -- Indica se o ticker do patrimony_items precisa de mapeamento antes de consultar o provedor
  -- Ex: 'PETR4' → 'PETR4.SA' no Yahoo Finance
  requires_ticker_mapping BOOLEAN    NOT NULL DEFAULT FALSE,
  -- Caminho do TS que implementa QuoteSourceAdapter (padrão class_path da arquitetura)
  adapter_class_path    VARCHAR(255) NOT NULL,
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Seed dos provedores conhecidos
INSERT INTO module_quote_sources
  (source_code, description, base_currency, requires_ticker_mapping, adapter_class_path)
VALUES
  ('brapi',          'BRAPI — ações e FIIs B3',         'BRL', FALSE, 'src/core/market/adapters/BrapiQuoteAdapter'),
  ('opcoes_net',     'Opções.net — opções B3',           'BRL', FALSE, 'src/core/market/adapters/OpcoesNetQuoteAdapter'),
  ('tesouro_direto', 'API Tesouro Direto',               'BRL', FALSE, 'src/core/market/adapters/TesouroDiretoQuoteAdapter'),
  ('computed_cdi',   'Calculado — CDI acumulado',        'BRL', FALSE, 'src/core/market/adapters/ComputedCdiQuoteAdapter'),
  ('computed_pre',   'Calculado — taxa PRÉ',             'BRL', FALSE, 'src/core/market/adapters/ComputedPreQuoteAdapter'),
  ('computed_ipca',  'Calculado — IPCA + spread',        'BRL', FALSE, 'src/core/market/adapters/ComputedIpcaQuoteAdapter'),
  ('yahoo_finance',  'Yahoo Finance — US stocks e ETFs', 'USD', TRUE,  'src/core/market/adapters/YahooFinanceQuoteAdapter'),
  ('coingecko',      'CoinGecko — criptomoedas',        'BRL', FALSE, 'src/core/market/adapters/CoinGeckoQuoteAdapter'),
  ('user_manual',    'Entrada manual pelo usuário',      'BRL', FALSE, 'src/core/market/adapters/ManualQuoteAdapter');

-- 4. Seed das flags para subcategorias INVEST já existentes
-- (ajustar se module_code ou subcategory name diferirem do seed existente)
UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = TRUE,
  default_quote_source     = 'brapi'
WHERE module_code = 'INVEST'
  AND subcategory IN ('stock', 'fii', 'etf', 'bdr');

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = TRUE,
  default_quote_source     = 'opcoes_net'
WHERE module_code = 'INVEST'
  AND subcategory IN ('option_call', 'option_put');

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = FALSE,
  default_quote_source     = 'computed_cdi'   -- ajustar conforme subtipo
WHERE module_code = 'INVEST'
  AND subcategory = 'fixed_income';

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = TRUE,
  default_quote_source     = 'yahoo_finance'
WHERE module_code = 'INVEST'
  AND subcategory IN ('stock_us', 'etf_us', 'reit');

UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = TRUE,
  default_quote_source     = 'coingecko'
WHERE module_code = 'INVEST'
  AND subcategory = 'crypto';

-- STOCKSPIN: estoque físico entra no patrimônio pelo PM ponderado — sem cotação de mercado
UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = FALSE,
  default_quote_source     = NULL
WHERE module_code = 'STOCKSPIN'
  AND subcategory IN ('sku', 'raw_material', 'finished_good');

-- REAL_ESTATE: imóveis entram no patrimônio pelo custo histórico (depreciação calculada)
UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = FALSE,
  default_quote_source     = NULL
WHERE module_code = 'REAL_ESTATE';

-- EDUCATION: cursos/apostilas entram no patrimônio pelo custo de produção
UPDATE module_categories SET
  contributes_to_patrimony = TRUE,
  requires_market_quote    = FALSE,
  default_quote_source     = NULL
WHERE module_code = 'EDUCATION';
```

**Ao adicionar nova subcategoria no futuro:** apenas `INSERT` em `module_categories`
com os valores corretos de `contributes_to_patrimony`, `requires_market_quote` e
`default_quote_source`. Nenhum código precisa mudar.

---

## Parte 2 — Interface TypeScript: `QuoteSourceAdapter`

**Arquivo a criar:** `src/core/market/QuoteSourceAdapter.ts`

```typescript
// Contrato que todo provedor de cotação deve implementar.
// Registrar o adaptador em module_quote_sources.adapter_class_path.

export interface QuoteSourceAdapter {
  readonly sourceCode: string;

  /**
   * Busca cotações para uma lista de tickers na data informada.
   * Retorna apenas os tickers que conseguiu cotar — os ausentes não lançam erro,
   * mas são logados para auditoria.
   */
  fetchQuotes(
    tickers: string[],
    date: string,            // YYYY-MM-DD
    currency: string,        // moeda base da organização (ex: 'BRL')
  ): Promise<QuoteResult[]>;
}

export interface QuoteResult {
  ticker:     string;
  date:       string;
  closePrice: number;
  currency:   string;
  source:     string;        // source_code do provedor
  fetchedAt:  string;        // ISO 8601 — quando foi buscado
}
```

**Arquivo a criar:** `src/core/market/QuoteSourceRegistry.ts`

```typescript
// Carrega os adaptadores dinamicamente a partir de module_quote_sources.adapter_class_path.
// Ao registrar um novo provedor no banco, ele fica disponível sem deploy.

import { QuoteSourceAdapter } from './QuoteSourceAdapter';
import { CoCeoDataGateway }   from '../dal/CoCeoDataGateway';

export class QuoteSourceRegistry {
  private cache = new Map<string, QuoteSourceAdapter>();

  constructor(private readonly gateway: CoCeoDataGateway) {}

  async getAdapter(sourceCode: string): Promise<QuoteSourceAdapter> {
    if (this.cache.has(sourceCode)) return this.cache.get(sourceCode)!;

    const [row] = await this.gateway.findWhere('module_quote_sources', {
      source_code: sourceCode,
      is_active:   true,
    });

    if (!row) {
      throw new Error(`Provedor de cotação desconhecido ou inativo: "${sourceCode}"`);
    }

    // Carregamento dinâmico — o módulo TS deve exportar default da classe
    const mod     = await import(`../../../${row.adapter_class_path}`);
    const adapter = new mod.default() as QuoteSourceAdapter;

    this.cache.set(sourceCode, adapter);
    return adapter;
  }
}
```

---

## Parte 3 — `ModuleCategoryFlags` — leitura única por sessão

**Arquivo a criar:** `src/core/module-registry/ModuleCategoryFlags.ts`

```typescript
// Carrega as flags de contributes_to_patrimony e requires_market_quote
// UMA VEZ por sessão/engine-run e expõe como métodos de consulta.
// Elimina qualquer Set/if hardcoded nos engines.

import { CoCeoDataGateway } from '../dal/CoCeoDataGateway';

export interface CategoryMeta {
  subcategory:              string;
  contributes_to_patrimony: boolean;
  requires_market_quote:    boolean;
  default_quote_source:     string | null;
}

export class ModuleCategoryFlags {
  private bySubcategory = new Map<string, CategoryMeta>();

  private constructor() {}

  static async load(gateway: CoCeoDataGateway): Promise<ModuleCategoryFlags> {
    const flags  = new ModuleCategoryFlags();
    const rows   = await gateway.findWhere('module_categories', {});

    for (const row of rows) {
      flags.bySubcategory.set(row.subcategory as string, {
        subcategory:              row.subcategory as string,
        contributes_to_patrimony: Boolean(row.contributes_to_patrimony),
        requires_market_quote:    Boolean(row.requires_market_quote),
        default_quote_source:     (row.default_quote_source as string) ?? null,
      });
    }

    return flags;
  }

  /** TRUE se o subcategory deve entrar no cálculo de patrimônio diário */
  contributesToPatrimony(subcategory: string): boolean {
    return this.bySubcategory.get(subcategory)?.contributes_to_patrimony ?? false;
  }

  /** TRUE se o subcategory precisa de cotação de mercado para valoração */
  requiresMarketQuote(subcategory: string): boolean {
    return this.bySubcategory.get(subcategory)?.requires_market_quote ?? false;
  }

  /** source_code do provedor padrão, ou null se não aplicável */
  defaultQuoteSource(subcategory: string): string | null {
    return this.bySubcategory.get(subcategory)?.default_quote_source ?? null;
  }

  /** Todos os subcategorys que precisam de cotação de mercado */
  allRequiringQuote(): string[] {
    return [...this.bySubcategory.values()]
      .filter(m => m.requires_market_quote)
      .map(m => m.subcategory);
  }

  /** Agrupa subcategorys por fonte de cotação */
  groupByQuoteSource(): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const meta of this.bySubcategory.values()) {
      if (!meta.requires_market_quote || !meta.default_quote_source) continue;
      const list = grouped.get(meta.default_quote_source) ?? [];
      list.push(meta.subcategory);
      grouped.set(meta.default_quote_source, list);
    }
    return grouped;
  }
}
```

---

## Parte 4 — `PatrimonyMtmDailyEngine.ts` — versão corrigida

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts`

Substituir os dois blocos hardcoded pelo uso de `ModuleCategoryFlags`:

```typescript
// ANTES — ERRADO (hardcode que viola a arquitetura)
if (p.assetType === 'stock' || p.assetType === 'fii') {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}

// DEPOIS — CORRETO (flags vêm do banco via module_categories)
if (categoryFlags.contributesToPatrimony(p.assetType)) {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}
```

A assinatura do engine precisa receber o `categoryFlags`:

```typescript
// Assinatura atual (presumida)
export function buildDailyPatrimonyMtmSeries(
  events:  LedgerEvent[],
  quotes:  Map<string, number>,
  options: PatrimonyMtmOptions,
): PatrimonyMtmResult { ... }

// Assinatura corrigida
export function buildDailyPatrimonyMtmSeries(
  events:        LedgerEvent[],
  quotes:        Map<string, number>,
  options:       PatrimonyMtmOptions,
  categoryFlags: ModuleCategoryFlags,   // ← injetado pelo caller
): PatrimonyMtmResult { ... }
```

O caller (`PatrimonyDailyRecorder.recordDay`) já tem acesso ao gateway e carrega uma vez:

```typescript
// Em PatrimonyDailyRecorder.recordDay (ou no construtor do serviço)
const categoryFlags = await ModuleCategoryFlags.load(this.gateway);
// ... passa para o engine
const result = buildDailyPatrimonyMtmSeries(events, quotes, mtmOpts, categoryFlags);
```

**Bug 2 — `fixedIncomeDynamic || fixedIncome` (falsy check errado):**

```typescript
// ANTES — ERRADO
const currentFixedIncome = fixedIncomeDynamic || fixedIncome;

// DEPOIS — CORRETO
// Verificar se há posições de RF com qty > 0 via categoryFlags,
// sem checar string de subcategory em código
const hasOpenPositions = (subcategory: string) =>
  [...positions.values()].some(
    p => p.assetType === subcategory && Math.abs(p.qty) > 0.0001
  );

// A lista de subcategorys de RF vem do banco (contributes_to_patrimony=true e computed)
// Por enquanto, filtrar pelas que NÃO requerem cotação de mercado como proxy de RF:
const hasOpenComputedPositions = [...positions.values()].some(
  p => categoryFlags.contributesToPatrimony(p.assetType)
    && !categoryFlags.requiresMarketQuote(p.assetType)
    && Math.abs(p.qty) > 0.0001
);

const currentFixedIncome = hasOpenComputedPositions ? fixedIncomeDynamic : fixedIncome;
```

> **Nota:** a longo prazo, adicionar coluna `valuation_mode ENUM('market_price', 'computed', 'historical_cost')` em `module_categories` para tornar esse critério também explícito no banco.

---

## Parte 5 — `PatrimonyDailyRecorder.ts` — guard corrigido

**Arquivo:** `src/core/invest/PatrimonyDailyRecorder.ts`

```typescript
// ANTES — ERRADO (hardcode)
private equityTickersOpenOnDate(events: LedgerEvent[], date: string): string[] {
  const tickers: string[] = [];
  for (const e of events) {
    const assetType = e.asset_type;
    if (assetType !== 'stock' && assetType !== 'fii') continue; // ← hardcode
    // ...
  }
  return tickers;
}

// DEPOIS — CORRETO (flags do banco)
private equityTickersOpenOnDate(
  events:        LedgerEvent[],
  date:          string,
  categoryFlags: ModuleCategoryFlags,   // ← recebido pelo construtor ou método
): string[] {
  const tickers: string[] = [];
  for (const e of events) {
    // "requer cotação" é a pergunta certa — não "é stock ou fii"
    if (!categoryFlags.requiresMarketQuote(e.asset_type)) continue;
    // ... resto da lógica permanece igual
  }
  return tickers;
}
```

---

## Parte 6 — `InvestQuoteSyncService.ts` — roteamento corrigido

**Arquivo:** `src/core/invest/InvestQuoteSyncService.ts` (ou `src/core/market/QuoteSyncService.ts`)

```typescript
// ANTES — ERRADO (roteamento por if/switch hardcoded por assetType)
async syncQuotesForDate(ctx: UserContext, date: string): Promise<SyncReport> {
  await this.syncBrapiQuotes(ctx, stockTickers,   date);
  await this.syncYahooQuotes(ctx, usTickers,      date);
  await this.syncCoinGecko  (ctx, cryptoTickers,  date);
}

// DEPOIS — CORRETO (roteamento via module_categories.default_quote_source)
async syncQuotesForDate(ctx: UserContext, date: string): Promise<SyncReport> {
  // 1. Carregar flags uma vez
  const categoryFlags = await ModuleCategoryFlags.load(this.gateway);

  // 2. Buscar ativos ativos da organização com qty > 0
  const openPositions = await this.positionRepo.listOpenOnDate(ctx, date);

  // 3. Agrupar por fonte de cotação — sem if hardcoded
  const bySource = new Map<string, string[]>();
  for (const pos of openPositions) {
    const source = categoryFlags.defaultQuoteSource(pos.subcategory);
    if (!source) continue; // subcategory sem cotação de mercado (ex: RF computada)

    const tickers = bySource.get(source) ?? [];
    tickers.push(pos.ticker);
    bySource.set(source, tickers);
  }

  // 4. Para cada fonte, obter o adaptador e buscar cotações
  const report: SyncReport = { synced: [], failed: [], skipped: [] };

  for (const [sourceCode, tickers] of bySource.entries()) {
    try {
      const adapter = await this.quoteSourceRegistry.getAdapter(sourceCode);
      const quotes  = await adapter.fetchQuotes(tickers, date, ctx.currency ?? 'BRL');
      await this.quoteRepo.bulkUpsert(ctx, quotes);
      report.synced.push(...quotes.map(q => q.ticker));
    } catch (err) {
      // Falha num provedor não derruba os demais
      report.failed.push({ source: sourceCode, tickers, error: String(err) });
    }
  }

  return report;
}
```

**Quando adicionar suporte a um novo provedor (ex: Alpha Vantage):**
1. Implementar `AlphaVantageQuoteAdapter implements QuoteSourceAdapter`
2. `INSERT INTO module_quote_sources (source_code='alpha_vantage', adapter_class_path='...', ...)`
3. `UPDATE module_categories SET default_quote_source='alpha_vantage' WHERE subcategory='...'`

Nenhum `if`, nenhum `switch`, nenhum `Set` muda.

---

## Parte 7 — `QuoteSource` type em `MarketQuoteRepository.ts`

O tipo `QuoteSource` em TypeScript pode e deve continuar existindo para type safety:

```typescript
// MANTER — type safety em TS é legítimo
export type QuoteSource =
  | 'brapi'
  | 'opcoes_net'
  | 'tesouro_direto'
  | 'computed_cdi'
  | 'computed_pre'
  | 'computed_ipca'
  | 'yahoo_finance'   // ← adicionar
  | 'coingecko'       // ← adicionar
  | 'user_manual';
```

**Diferença crucial:** o `QuoteSource` union type é uma **lista de opções válidas** para
type checking — não é routing de negócio. O que NÃO pode existir em código é:

```typescript
// PROIBIDO — regra de negócio em código
if (assetType === 'stock_us') useYahooFinance();
if (assetType === 'crypto')   useCoinGecko();
```

Regra: o union `QuoteSource` pode existir. O mapeamento "subcategory X usa source Y" 
mora em `module_categories.default_quote_source`.

---

## Parte 8 — `valuation_mode` (melhoria futura, não bloqueia a release)

Para tornar o Bug 2 (RF estática vs. dinâmica) também explícito no banco, adicionar
em uma migration futura:

```sql
-- Migration futura (não bloqueia release atual)
ALTER TABLE module_categories
  ADD COLUMN valuation_mode ENUM('market_price', 'computed', 'historical_cost')
    NOT NULL DEFAULT 'historical_cost'
    COMMENT 'Como o patrimônio deste subcategory é valorado no fechamento diário';

UPDATE module_categories SET valuation_mode = 'market_price'
  WHERE requires_market_quote = TRUE;

UPDATE module_categories SET valuation_mode = 'computed'
  WHERE subcategory IN ('fixed_income') AND module_code = 'INVEST';
```

Com isso, o engine pode substituir o critério de RF por:

```typescript
// Usando valuation_mode do banco — sem nenhum hardcode
const isComputedValuation = (subcategory: string) =>
  categoryFlags.valuationMode(subcategory) === 'computed';
```

---

## Resumo das mudanças

| O que muda | Onde | Tipo |
|---|---|---|
| `+contributes_to_patrimony`, `+requires_market_quote`, `+default_quote_source` | `module_categories` | Migration SQL |
| Tabela `module_quote_sources` com provedores | Banco | Migration SQL |
| Seeds das flags por subcategory | `module_categories` | Migration SQL |
| `ModuleCategoryFlags` — carrega flags do banco | `src/core/module-registry/` | Arquivo TS novo |
| `QuoteSourceAdapter` — interface de provedor | `src/core/market/` | Arquivo TS novo |
| `QuoteSourceRegistry` — carrega adaptadores dinamicamente | `src/core/market/` | Arquivo TS novo |
| Loops no engine — usar `categoryFlags.contributesToPatrimony()` | `PatrimonyMtmDailyEngine.ts` | Edição |
| Guard do recorder — usar `categoryFlags.requiresMarketQuote()` | `PatrimonyDailyRecorder.ts` | Edição |
| Roteamento do sync — usar `categoryFlags.defaultQuoteSource()` | `InvestQuoteSyncService.ts` | Edição |
| `QuoteSource` union — adicionar `yahoo_finance`, `coingecko` | `MarketQuoteRepository.ts` | Edição pequena |

---

## O que **não** muda

- `LedgerEvent` e seu `assetType` — continuam como estão
- `PatrimonyMtmOptions` — continua como está
- Engines de 3 preços, CustodyEngine, PnLPivotEngine — não tocam nisso
- Lógica de conciliação — não é afetada

---

## Definition of Done

- [ ] Migration 36 aplicada sem erro em dev e homologação
- [ ] Seeds: todas as subcategorias INVEST com `contributes_to_patrimony`, `requires_market_quote` e `default_quote_source` corretos
- [ ] `ModuleCategoryFlags` com testes unitários cobrindo `load()`, `contributesToPatrimony()`, `requiresMarketQuote()`, `groupByQuoteSource()`
- [ ] `PatrimonyMtmDailyEngine` recebendo `categoryFlags` por injeção — zero `Set` ou `if` de assetType
- [ ] `PatrimonyDailyRecorder` usando `requiresMarketQuote()` no guard — zero string literal de tipo de ativo
- [ ] `InvestQuoteSyncService` roteando por `default_quote_source` — zero `if (assetType === 'stock_us')`
- [ ] `npm run build` sem erros
- [ ] `npm test` sem regressões
- [ ] Teste manual: adicionar nova subcategoria `stock_uk` com `default_quote_source = 'yahoo_finance'` no banco → patrimônio passa a incluí-la sem deploy
