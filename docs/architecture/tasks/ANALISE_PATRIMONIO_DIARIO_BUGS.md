# Análise: Por que o Patrimônio Diário está Calculando Errado

**Data:** 05/06/2026 | Arquivos lidos: PatrimonyMtmDailyEngine.ts, PatrimonyDailyRecorder.ts, MarketQuoteRepository.ts

---

## Diagnóstico raiz: 3 bugs, 1 gap de arquitetura

---

## BUG 1 — CRÍTICO: US stocks, crypto e BDRs contribuem ZERO ao patrimônio

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts`

O loop de valoração ao final do dia trata apenas `stock` e `fii`:

```typescript
// HOJE — só stock e fii entram na conta
if (p.assetType === 'stock' || p.assetType === 'fii') {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;   // ← US stocks, crypto, BDR: NUNCA chegam aqui
}
```

Qualquer ativo com `assetType` diferente de `stock`, `fii`, `option_call`, `option_put` ou `fixed_income` **cai silenciosamente fora do cálculo**. O patrimônio é calculado sem eles. Nenhum erro é lançado.

Tipos afetados hoje:
- `stock_us` (AAPL, MSFT, AMZN, etc.)
- `crypto` (BTC, ETH, etc.)
- `bdr` (BDRs de empresas estrangeiras)
- qualquer novo tipo adicionado no futuro via `module_categories`

**Correção:**

```typescript
// DEPOIS — todos os ativos "equity-like" entram na conta
const EQUITY_LIKE_TYPES = new Set([
  'stock', 'fii', 'etf',
  'stock_us', 'etf_us',      // ← US
  'bdr',                      // ← BDRs
  'crypto',                   // ← cripto
  'reit',                     // ← fundos imobiliários internacionais
]);

if (EQUITY_LIKE_TYPES.has(p.assetType)) {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}
```

**Atenção para US stocks e crypto:** esses ativos precisam ter cotações em `market_quotes_daily`. A fonte de cotação deve ser configurada (Yahoo Finance, CoinGecko, etc.) — ver BUG 3.

---

## BUG 2 — ALTO: `fixedIncomeDynamic || fixedIncome` — falsy check errado

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts`

```typescript
// HOJE — bug JavaScript clássico
const currentFixedIncome = fixedIncomeDynamic || fixedIncome;
```

Se `fixedIncomeDynamic` é `0` (nenhuma posição de renda fixa aberta), JS avalia `0 || fixedIncome` como `fixedIncome` — que é o valor estático das âncoras BTG. Resultado: o patrimônio inclui renda fixa **mesmo quando não há posição aberta**, usando o valor do mês anterior.

Isso inflaciona o patrimônio em datas onde a posição de RF foi zerada mas a âncora do mês ainda tem valor.

**Correção:**

```typescript
// DEPOIS — verificar se há posições de RF abertas
const hasOpenFixedIncome = [...positions.values()].some(
  (p) => isFixedIncome(p.assetType, p.ticker) && Math.abs(p.qty) > 0.0001
);
const currentFixedIncome = hasOpenFixedIncome ? fixedIncomeDynamic : fixedIncome;
```

---

## BUG 3 — ALTO: Âncoras mensais BTG — JSON local vs banco de dados

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts` + `src/core/invest/patrimonyAnchors.ts`

O engine tem dois caminhos para carregar âncoras:

```typescript
// Caminho 1: opção passada pelo caller (PatrimonyDailyRecorder → banco)
const anchors = options?.anchors ?? loadPatrimonyAnchors(); // ← fallback

// Caminho 2: loadPatrimonyAnchors() — carrega arquivo JSON LOCAL
```

O `PatrimonyDailyRecorder.recordDay` carrega do banco corretamente:
```typescript
const anchors = await this.anchorsRepo.loadForOrganization(ctx); // ← banco ✅
```

E passa para o engine via `mtmOpts.anchors`. Isso está correto.

**O problema:** se o banco não tiver âncoras (`hasAnchors === false`), o recorder desativa a calibração (`useCalibration = false`). Nesses dias, o engine usa `loadPatrimonyAnchors()` como fallback — que lê um arquivo JSON estático local. Se esse arquivo tiver dados antigos ou não existir, o patrimônio é calculado sem calibração às referências BTG.

**Verificar:**
```bash
# 1. Verificar se há âncoras no banco para a holding
GET /api/invest/reconcile/patrimony-anchors
# Esperado: array com fechamentos mensais BTG

# 2. Se vazio, popular âncoras:
POST /api/invest/reconcile/patrimony-anchors/seed-btg
```

Se as âncoras estiverem no banco mas o patrimônio ainda divergir, verificar se `invest_patrimony_monthly_anchors` tem o `organization_id` correto (patrimônio aparece diferente em holding X vs Y).

---

## BUG 4 — MÉDIO: `assertEquityQuotesForBusinessDay` não verifica US stocks e crypto

**Arquivo:** `src/core/invest/PatrimonyDailyRecorder.ts`

O guard que bloqueia o registro de patrimônio sem cotação só verifica `stock` e `fii`:

```typescript
private equityTickersOpenOnDate(events, date): string[] {
  // ...
  if (assetType !== 'stock' && assetType !== 'fii') continue; // ← ignora stock_us, crypto
  // ...
}
```

Resultado: o recorder aceita gravar o dia sem cotação de AAPL, BTC, etc. O patrimônio é gravado com esses ativos valendo ZERO ou custo histórico, sem aviso.

**Correção:**

```typescript
// Incluir todos os tipos equity-like na verificação
const EQUITY_REQUIRES_QUOTE = new Set(['stock', 'fii', 'etf', 'stock_us', 'etf_us', 'bdr', 'crypto', 'reit']);

if (!EQUITY_REQUIRES_QUOTE.has(assetType)) continue;
```

---

## GAP DE ARQUITETURA: Fontes de cotação para US stocks e crypto

**Arquivo:** `src/core/market/MarketQuoteRepository.ts`

O repositório de cotações tem as seguintes fontes definidas:

```typescript
export type QuoteSource =
  | 'brapi'           // ← ações B3
  | 'opcoes_net'      // ← opções B3
  | 'tesouro_direto'  // ← Tesouro Direto
  | 'computed_cdi'    // ← renda fixa CDI
  | 'computed_pre'    // ← renda fixa PRÉ
  | 'computed_ipca'   // ← renda fixa IPCA
  | 'user_manual';    // ← entrada manual
```

**Não existem fontes para:**
- US stocks (Yahoo Finance, Alpha Vantage, Polygon)
- Crypto (CoinGecko, Binance, CryptoCompare)
- BDRs (esses têm ISIN B3 e podem ser buscados via brapi, mas precisam de tratamento especial)

Isso significa que mesmo após corrigir o BUG 1, os ativos US e crypto continuarão valendo ZERO por falta de cotação — a menos que você grave manualmente via `user_manual`.

**O que precisa ser implementado:**

```typescript
// Adicionar à QuoteSource:
export type QuoteSource =
  | 'brapi'
  | 'yahoo_finance'    // ← US stocks (ex: AAPL, MSFT)
  | 'coingecko'        // ← crypto (ex: BTC, ETH)
  | 'cryptocompare'    // ← alternativa crypto
  | 'opcoes_net'
  | 'tesouro_direto'
  | 'computed_cdi'
  | 'computed_pre'
  | 'computed_ipca'
  | 'user_manual';
```

E criar um `InvestQuoteSyncService` com suporte a múltiplas fontes, roteando por `assetType`:

```typescript
async syncQuotesForDate(ctx: UserContext, date: string): Promise<SyncReport> {
  const assetsByType = await this.groupAssetsByType(ctx);

  // B3: brapi
  await this.syncBrapiQuotes(ctx, assetsByType.get('stock') ?? [], date);
  await this.syncBrapiQuotes(ctx, assetsByType.get('fii')   ?? [], date);
  await this.syncBrapiQuotes(ctx, assetsByType.get('bdr')   ?? [], date);

  // US: Yahoo Finance
  await this.syncYahooQuotes(ctx, assetsByType.get('stock_us') ?? [], date);
  await this.syncYahooQuotes(ctx, assetsByType.get('etf_us')   ?? [], date);

  // Crypto: CoinGecko
  await this.syncCoinGeckoQuotes(ctx, assetsByType.get('crypto') ?? [], date);
}
```

---

## Resumo dos problemas por impacto

| Problema | Impacto | Arquivo | Correção |
|---|---|---|---|
| US/crypto/BDR = ZERO no patrimônio | Patrimônio errado se houver esses ativos | `PatrimonyMtmDailyEngine.ts` | Expandir `EQUITY_LIKE_TYPES` |
| `fixedIncomeDynamic \|\| fixedIncome` | Patrimônio inflado quando RF zera | `PatrimonyMtmDailyEngine.ts` | Checar posições abertas |
| Âncoras BTG não carregadas | Curva sem calibração BTG | `invest_patrimony_monthly_anchors` | Confirmar seed no banco |
| Guard de cotações não cobre US/crypto | Gravação silenciosa sem preço | `PatrimonyDailyRecorder.ts` | Expandir `EQUITY_REQUIRES_QUOTE` |
| Sem fonte de cotação para US/crypto | Preços nunca chegam ao banco | `MarketQuoteRepository.ts` | Novo sync provider |

---

## Tasks para os agentes

### Task P1 — Expandir `EQUITY_LIKE_TYPES` no engine (CRÍTICO)

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts`

Localizar o bloco:
```typescript
if (p.assetType === 'stock' || p.assetType === 'fii') {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}
```

Substituir por:
```typescript
const EQUITY_LIKE_TYPES = new Set([
  'stock', 'fii', 'etf',
  'stock_us', 'etf_us',
  'bdr',
  'crypto',
  'reit',
]);

if (EQUITY_LIKE_TYPES.has(p.assetType)) {
  const mark = dailyMark ?? 0;
  stocksValue += p.qty * mark;
}
```

Mesma expansão no `snapshotOpenPositions`:
```typescript
if (p.assetType === 'stock' || p.assetType === 'fii') {
```
Substituir por:
```typescript
if (EQUITY_LIKE_TYPES.has(p.assetType)) {
```

### Task P2 — Corrigir `fixedIncomeDynamic || fixedIncome`

**Arquivo:** `src/core/invest/PatrimonyMtmDailyEngine.ts`

Localizar:
```typescript
const currentFixedIncome = fixedIncomeDynamic || fixedIncome;
```

Substituir por:
```typescript
const hasOpenFixedIncome = [...positions.values()].some(
  (p) => isFixedIncome(p.assetType, p.ticker) && Math.abs(p.qty) > 0.0001
);
const currentFixedIncome = hasOpenFixedIncome ? fixedIncomeDynamic : fixedIncome;
```

### Task P3 — Expandir guard de cotações

**Arquivo:** `src/core/invest/PatrimonyDailyRecorder.ts`

Localizar em `equityTickersOpenOnDate`:
```typescript
if (assetType !== 'stock' && assetType !== 'fii') continue;
```

Substituir por:
```typescript
const EQUITY_REQUIRES_QUOTE = new Set([
  'stock', 'fii', 'etf', 'stock_us', 'etf_us', 'bdr', 'crypto', 'reit',
]);
if (!EQUITY_REQUIRES_QUOTE.has(assetType)) continue;
```

### Task P4 — Adicionar `yahoo_finance` e `coingecko` como `QuoteSource`

**Arquivo:** `src/core/market/MarketQuoteRepository.ts`

Adicionar à union type `QuoteSource`:
```typescript
| 'yahoo_finance'
| 'coingecko'
| 'cryptocompare'
| 'binance'
```

### Task P5 — Verificar âncoras no banco

Antes de qualquer rebuild:
```bash
GET /api/invest/reconcile/patrimony-anchors
# Se array vazio:
POST /api/invest/reconcile/patrimony-anchors/seed-btg
# Depois:
POST /api/invest/patrimony-daily/rebuild
```

---

## Definition of Done

- [ ] `EQUITY_LIKE_TYPES` incluindo `stock_us`, `crypto`, `bdr`
- [ ] `fixedIncomeDynamic` verificando posições abertas
- [ ] Guard de cotações cobrindo novos tipos
- [ ] `QuoteSource` com `yahoo_finance` e `coingecko`
- [ ] `invest_patrimony_monthly_anchors` populada no banco para a holding
- [ ] `npm run build` sem erros / `npm test` sem regressões
- [ ] Após rebuild: patrimônio dos dias com AAPL/BTC != 0 (se cotações disponíveis)
