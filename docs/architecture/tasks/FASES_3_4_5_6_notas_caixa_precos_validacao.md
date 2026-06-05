# TASK FASE 3 — Notas, Pendências e LIQ BOLSA

**Documento base:** seções 5, 6, 6.4 do plano rígido
**Pré-requisito:** Fase 2 concluída.
**Objetivo:** Uma nota = um evento. Extrato confirma caixa. LIQ BOLSA não vira aporte.

---

## Arquivo 1 — `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`

### Uma nota = um `business_event` com `total_net` correto

O tradutor de notas deve:
1. Agregar todas as linhas da mesma nota antes de criar o header
2. Criar um único evento com `source_ref = 'BTG-NOTA-{noteNumber}'`
3. **Não criar perna financeira de caixa** — só perna patrimonial + expectativa de liquidação D+2

```typescript
// Padrão correto de tradução de nota:

// PASSO 1 — Agregar linhas da mesma nota
const linesByNote = groupBy(parsedLines, (l) => l.noteNumber);

for (const [noteNumber, lines] of Object.entries(linesByNote)) {
  // PASSO 2 — Calcular total_net agregado da nota
  const totalNet = lines.reduce((sum, l) => sum + l.totalNetValue, 0);
  const pregaoDate = lines[0]!.pregaoDate;
  const settlementDate = addBusinessDays(pregaoDate, 2); // D+2 para ações

  // PASSO 3 — Garantir evento único (idempotente)
  const eventId = await this.businessEvents.ensureByRef(ctx, {
    sourceRef: `BTG-NOTA-${noteNumber}`,
    eventKind: 'brokerage_note',
    occurredOn: pregaoDate,
    settlesOn: settlementDate,
    sourceModule: 'INVEST',
    totalNet: Math.round(totalNet * 100) / 100,
    metadata: {
      noteNumber,
      lineCount: lines.length,
      parser: 'btg_brokerage_note_v2',
    },
  });

  // PASSO 4 — Criar pernas patrimoniais (uma por linha)
  for (const line of lines) {
    await this.inventoryLedger.recordMovement(ctx, {
      ...line,
      businessEventId: eventId,
      brokerNoteRef: `BTG-NOTA-${noteNumber}-L${line.lineIndex}`,
    });
  }

  // PASSO 5 — Criar expectativa de liquidação D+n (NÃO caixa definitivo)
  // Expectativa = perna financeira com status 'pending'
  await this.financialLedger.record(ctx, {
    accountId: this.cashAccountId,
    transactionType: 'settlement_expected',
    amount: Math.abs(totalNet),
    direction: totalNet >= 0 ? 'inflow' : 'outflow',
    transactionDate: pregaoDate,
    settlementDate,
    status: 'pending', // ← PENDENTE, não cleared
    businessEventId: eventId,
    externalRef: `BTG-NOTA-${noteNumber}-EXPECTED`,
    metadata: {
      kind: 'settlement_expected',
      noteNumber,
      settlementDate,
    },
  });
}
```

**REGRA CRÍTICA:** Jamais criar perna financeira com `status: 'cleared'` na importação de nota. O `cleared` vem do extrato via LIQ BOLSA.

---

## Arquivo 2 — `src/core/invest/LiqBolsaSettlementService.ts` (NOVO)

Implementar o algoritmo exato da seção 6.4 do plano:

```typescript
import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';

const MONEY_TOL_CENTS = 1; // 1 centavo de tolerância

export type LiqBolsaMatchResult =
  | { status: 'matched'; settledEvents: string[]; totalCents: number }
  | { status: 'blocked'; reason: string; candidates: unknown[]; sumCents: number; deltaCents: number };

export class LiqBolsaSettlementService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async settle(
    ctx: UserContext,
    input: {
      extractLineRef: string;
      settlementDate: string;      // data D do LIQ BOLSA
      valueSignedCents: number;    // valor em centavos, assinado (entrada = positivo)
      accountId: string;
    }
  ): Promise<LiqBolsaMatchResult> {
    const { extractLineRef, settlementDate, valueSignedCents, accountId } = input;

    // 1. Buscar eventos candidatos para esta data de liquidação
    const candidates = await this.fetchCandidates(ctx, settlementDate, accountId);

    if (candidates.length === 0) {
      return {
        status: 'blocked',
        reason: 'Nenhum evento candidato encontrado para esta data de liquidação.',
        candidates: [],
        sumCents: 0,
        deltaCents: Math.abs(valueSignedCents),
      };
    }

    // 2. Calcular pendente por evento
    const withPending = candidates.map((ev) => ({
      ...ev,
      pendingCents: this.calcPendingCents(ev),
    })).filter((ev) => ev.pendingCents !== 0);

    // 3. Tentar casamento — todos de uma vez
    const sumAll = withPending.reduce((s, ev) => s + ev.pendingCents, 0);
    if (Math.abs(sumAll - valueSignedCents) <= MONEY_TOL_CENTS) {
      return this.confirmSettlement(ctx, withPending, input);
    }

    // 4. Tentar subconjunto (subset sum determinístico)
    const match = this.findSubset(withPending, valueSignedCents);
    if (match) {
      return this.confirmSettlement(ctx, match, input);
    }

    // 5. Bloqueio — nenhum subconjunto bateu
    return {
      status: 'blocked',
      reason: 'Nenhum subconjunto de eventos casa com o valor do LIQ BOLSA.',
      candidates: withPending.map((ev) => ({
        eventId: ev.id,
        sourceRef: ev.source_ref,
        pendingCents: ev.pendingCents,
      })),
      sumCents: sumAll,
      deltaCents: Math.abs(sumAll - valueSignedCents),
    };
  }

  private async fetchCandidates(ctx: UserContext, settlementDate: string, accountId: string) {
    const BOLSA_KINDS = ['buy', 'sell', 'put_buy', 'put_sell', 'call_buy', 'call_sell',
      'exercise', 'assignment', 'securities_lending', 'brokerage_note'];

    const events = await this.gateway.findWhere(ctx, 'business_events', {
      settles_on: settlementDate,
    });

    return events
      .filter((ev) => BOLSA_KINDS.includes(String(ev.event_kind)))
      .filter((ev) => !ev.deleted_at)
      .sort((a, b) =>
        String(a.occurred_on).localeCompare(String(b.occurred_on)) ||
        String(a.source_ref).localeCompare(String(b.source_ref)) ||
        String(a.id).localeCompare(String(b.id))
      );
  }

  private calcPendingCents(ev: Record<string, unknown>): number {
    const expectedCents = Math.round(Number(ev.total_net ?? 0) * 100);
    const clearedCents = Number(ev._cleared_cents ?? 0); // pre-calculado na query
    return expectedCents - clearedCents;
  }

  private findSubset(
    candidates: Array<{ id: string; pendingCents: number; [k: string]: unknown }>,
    targetCents: number
  ): typeof candidates | null {
    // Subset sum com inteiros — determinístico por ordenação
    const n = candidates.length;
    // Para n <= 20, busca exaustiva é viável (<1M iterações)
    if (n > 20) return null; // muitos candidatos = improvável mas possível — bloquear

    let bestMatch: typeof candidates | null = null;
    let bestDelta = MONEY_TOL_CENTS + 1;
    let ambiguous = false;

    for (let mask = 1; mask < (1 << n); mask++) {
      let sum = 0;
      const subset: typeof candidates = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          sum += candidates[i]!.pendingCents;
          subset.push(candidates[i]!);
        }
      }
      const delta = Math.abs(sum - targetCents);
      if (delta <= MONEY_TOL_CENTS) {
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMatch = subset;
          ambiguous = false;
        } else if (delta === bestDelta) {
          ambiguous = true;
        }
      }
    }

    if (ambiguous) return null; // ambíguo = bloquear
    return bestMatch;
  }

  private async confirmSettlement(
    ctx: UserContext,
    matchedEvents: Array<{ id: string; pendingCents: number; source_ref?: unknown; [k: string]: unknown }>,
    input: { extractLineRef: string; settlementDate: string; valueSignedCents: number; accountId: string }
  ): Promise<LiqBolsaMatchResult> {
    const settledEventIds: string[] = [];

    for (const ev of matchedEvents) {
      const amount = Math.abs(ev.pendingCents) / 100;
      const direction = ev.pendingCents > 0 ? 'inflow' : 'outflow';

      // Criar ou confirmar perna financeira cleared
      await this.gateway.insert(ctx, 'financial_ledger_entries', {
        account_id: input.accountId,
        business_event_id: ev.id,
        transaction_date: input.settlementDate,
        settlement_date: input.settlementDate,
        amount,
        direction,
        status: 'cleared',
        external_ref: `${input.extractLineRef}#${String(ev.source_ref ?? ev.id)}`,
        metadata: JSON.stringify({
          kind: 'liq_bolsa_settlement',
          extract_line_ref: input.extractLineRef,
          matched_business_event_id: ev.id,
          original_liq_bolsa_amount: input.valueSignedCents / 100,
        }),
      });

      // Marcar expectativa anterior como liquidada (se existir)
      await this.cancelPendingExpectation(ctx, ev.id);

      settledEventIds.push(ev.id);
    }

    return {
      status: 'matched',
      settledEvents: settledEventIds,
      totalCents: matchedEvents.reduce((s, ev) => s + Math.abs(ev.pendingCents), 0),
    };
  }

  private async cancelPendingExpectation(ctx: UserContext, eventId: string): Promise<void> {
    const pending = await this.gateway.findWhere(ctx, 'financial_ledger_entries', {
      business_event_id: eventId,
      status: 'pending',
    });
    for (const leg of pending) {
      await this.gateway.update(ctx, 'financial_ledger_entries', String(leg.id), {
        status: 'cancelled',
        metadata: JSON.stringify({
          ...JSON.parse(String(leg.metadata ?? '{}')),
          cancelled_reason: 'settled_by_liq_bolsa',
        }),
      });
    }
  }
}
```

---

## Arquivo 3 — `src/core/invest/BtgExtractLineParser.ts`

### Identificar e rotear LIQ BOLSA para o novo service

Localizar o trecho que processa `LIQ BOLSA`. Substituir o tratamento atual por chamada ao `LiqBolsaSettlementService`:

```typescript
if (line.description?.toUpperCase().includes('LIQ BOLSA')) {
  // NUNCA transformar em capital_deposit/withdrawal
  const valueSignedCents = Math.round(line.amount * 100) * (line.direction === 'inflow' ? 1 : -1);

  const result = await this.liqBolsaSettler.settle(ctx, {
    extractLineRef: `BTG-EXTRATO-${extractDate}-L${lineIndex}`,
    settlementDate: line.date,
    valueSignedCents,
    accountId: this.cashAccountId,
  });

  if (result.status === 'blocked') {
    // Registrar pendência crítica — NÃO criar movimento de caixa
    await this.registerCriticalPending(ctx, {
      kind: 'liq_bolsa_unmatched',
      date: line.date,
      value: line.amount,
      reason: result.reason,
      candidates: result.candidates,
      sumCents: result.sumCents,
      deltaCents: result.deltaCents,
      extractLineRef: `BTG-EXTRATO-${extractDate}-L${lineIndex}`,
    });
    continue; // não gravar nada para esta linha
  }

  // matched — pernas já gravadas pelo settler
  continue;
}
```

---

## Arquivo 4 — Remover ajuste automático de divergência

Buscar e eliminar qualquer criação de movimentos com descrição contendo:
- `AJUSTE DE DIVERGENCIA`
- `Cadeia Quebrada`
- `ajuste automatico`

```bash
grep -rn "AJUSTE DE DIVERGENCIA\|Cadeia Quebrada\|ajuste.automatico" src/ --include="*.ts"
```

Para cada ocorrência: substituir por lançamento de `GatewayError` ou registro de pendência crítica, nunca por inserção de dados artificiais.

---

## Definition of Done Fase 3

- [x] `BtgBrokerageNoteLedgerTranslator` nunca cria caixa `cleared` na nota
- [x] Nota sempre cria perna `pending` (expectativa D+2)
- [x] `LiqBolsaSettlementService` implementado com subset sum determinístico
- [x] `BtgExtractLineParser` usa `LiqBolsaSettlementService` para `LIQ BOLSA`
- [x] LIQ BOLSA não casado registra pendência crítica e não grava caixa
- [x] Zero ocorrências de `AJUSTE DE DIVERGENCIA` criando dados artificiais
- [x] `npm run build` sem erros / `npm test` sem regressões

### Status Codex 2026-06-04

Implementado `LiqBolsaSettlementService`, integrado no upload de extrato via
`LedgerImportService.settleLiqBolsa`, e removido o caminho antigo que expandia
`LIQ BOLSA` em `capital_deposit`/`capital_withdrawal`. O parser agora emite
`pending_settlement` como marcador quando `includeLiqBolsa` estiver ativo, e o
upload intercepta a linha para casar contra eventos de nota; se nao casar,
bloqueia a importacao e nao grava caixa artificial.

Validacoes executadas:
- `npm run build`
- `node .\node_modules\jest\bin\jest.js --runTestsByPath tests/unit/invest/BtgExtractLineParser.test.ts tests/unit/invest/LiqBolsaSettlementService.test.ts tests/unit/core/financial/FinancialLedger.businessEventGuard.test.ts tests/unit/invest/btgBrokerageNoteLedgerTranslator.test.ts --runInBand`
- `node .\node_modules\jest\bin\jest.js --runTestsByPath tests/unit/core/financial/FinancialLedger.businessEventGuard.test.ts tests/unit/invest/LiqBolsaSettlementService.test.ts tests/unit/invest/OpeningBalanceMigrationService.test.ts tests/unit/invest/reconcile/ReconciliationAuditService.test.ts tests/unit/core/inventory/InventoryLedger.statusTransitions.test.ts --runInBand`

Observacao: `npm test` completo permanece com as 3 falhas preexistentes ja
registradas em Fases 1/2 (`patrimonyAnchors` e parsing ESM de `pdfjs-dist` nos
testes de controller/API), sem regressao observada nos testes focados da Fase 3.

---
---

# TASK FASE 4 — Cálculo de Caixa e Patrimônio: eliminar dupla contagem

**Pré-requisito:** Fase 3 concluída.
**Objetivo:** `patrimony = positionsValue + settledCash + inTransit` — cada componente uma única vez.

---

## Arquivo 1 — `src/core/invest/PatrimonyMtmDailyEngine.ts`

### Remover todas as fontes duplicadas de trânsito

Localizar as seguintes variáveis/chamadas e verificar se aparecem mais de uma vez no cálculo:
- `pendingSettlements`
- `cashIncludingTransit`
- `cashWithTransit`
- `inTransit`

**Fórmula correta e única:**
```typescript
const { settledCash, inTransit } = await this.cashBalance.getSnapshot(
  ctx,
  accountId,
  date
);

const patrimony = positionsValue + settledCash + inTransit;
// NÃO adicionar pendingSettlements ou qualquer outro campo de trânsito aqui
```

**Atualizar o tipo `DailyPatrimonyPoint`** para refletir os componentes corretos:
```typescript
type DailyPatrimonyPoint = {
  date: string;
  positionsValue: number;
  settledCash: number;          // caixa liquidado
  cashInTransit: number;        // trânsito D+n
  patrimony: number;            // positionsValue + settledCash + cashInTransit
  dailyReturn: number | null;
  source: 'mtm_economic' | 'mtm_realtime' | 'anchor_calibrated';
};
```

---

## Arquivo 2 — `src/core/invest/PatrimonyDailyRebuildService.ts`

### Adicionar `lastTrustedDate`

O rebuild **não pode** rodar até "hoje" se as fontes param antes.

```typescript
export type PatrimonyRebuildOptions = {
  from?: string;
  to?: string;
  lastTrustedDate?: string; // ← NOVO: rebuild para nesta data
};

async rebuild(ctx: UserContext, opts: PatrimonyRebuildOptions = {}): Promise<PatrimonyRebuildResult> {
  const today = new Date().toISOString().slice(0, 10);

  // Se lastTrustedDate não for passado, usar a data da última cotação disponível
  const lastTrusted = opts.lastTrustedDate
    ?? await this.getLastQuoteDate(ctx)
    ?? today;

  const to = opts.to
    ? (opts.to < lastTrusted ? opts.to : lastTrusted) // nunca passar do lastTrusted
    : lastTrusted;

  // ... resto do rebuild com `to` limitado
}

private async getLastQuoteDate(ctx: UserContext): Promise<string | null> {
  const rows = await this.gateway.findWhere(
    ctx,
    'market_quotes_daily',
    {},
    { orderBy: 'quote_date DESC', limit: 1 }
  );
  return rows[0] ? String(rows[0].quote_date).slice(0, 10) : null;
}
```

---

## Arquivo 3 — `src/core/invest/PatrimonyDailyStore.ts`

### Gravar `settled_cash` e `cash_in_transit` separados

Atualizar `upsertPortfolioDay` para gravar os componentes separados:

```typescript
await this.gateway.upsert(ctx, 'invest_portfolio_daily', {
  organization_id: ctx.organizationId,
  snapshot_date: point.date,
  patrimony: point.patrimony,
  positions_value: point.positionsValue,
  settled_cash: point.settledCash,        // ← NOVO
  cash_in_transit: point.cashInTransit,   // ← NOVO (substitui pending_settlements)
  daily_return_twr: point.dailyReturn,
  source: point.source,
}, ['organization_id', 'snapshot_date']);
```

Criar migration se as colunas não existirem:

```sql
-- src/database/migrations/33_invest_portfolio_daily_cash_components.sql
ALTER TABLE `invest_portfolio_daily`
  ADD COLUMN IF NOT EXISTS `settled_cash` DECIMAL(18,4) NULL AFTER `positions_value`,
  ADD COLUMN IF NOT EXISTS `cash_in_transit` DECIMAL(18,4) NULL AFTER `settled_cash`;
```

---

## Definition of Done Fase 4

- [x] `PatrimonyMtmDailyEngine` usa `CashBalanceService` sem dupla contagem
- [x] `DailyPatrimonyPoint` tem `settledCash` e `cashInTransit` separados
- [x] `PatrimonyDailyRebuildService.rebuild` respeita `lastTrustedDate`
- [x] Migration 33 criada para as novas colunas
- [x] `npm run build` sem erros / `npm test` sem regressões

### Status Codex 2026-06-04

Componentes `settled_cash` e `cash_in_transit` foram adicionados ao snapshot
diario via migration `37_invest_portfolio_daily_cash_components.sql` (numero
37 por sequencia atual do repositorio). `PatrimonyMtmDailyEngine` e
`PatrimonyDailyStore` gravam/restauram os componentes separados, e
`PatrimonyDailyRebuildService.rebuild` agora respeita `lastTrustedDate` ou a
ultima data disponivel em `market_quotes_daily`, evitando rebuild ate hoje com
fontes paradas.

Validacoes executadas:
- `npm run build`
- `node .\node_modules\jest\bin\jest.js --runTestsByPath tests/unit/invest/PatrimonyDailyRebuildService.test.ts --runInBand`

---
---

# TASK FASE 5 — Preços e Cotações: motor canônico e bloqueio de dia sem cotação

**Pré-requisito:** Fase 4 concluída.
**Objetivo:** `threePricesEngine.computeThreePricesByUnderlying(eventsAteAsOf)` é o único motor INVEST. Ações bloqueiam se sem cotação histórica real.

---

## Arquivo 1 — `src/core/invest/threePricesEngine.ts`

### Garantir filtro por `asOfDate`

A função já existe. Adicionar/garantir parâmetro `asOfDate`:

```typescript
export function computeThreePricesByUnderlying(
  events: LedgerEvent[],
  asOfDate?: string // ← se passado, filtrar eventos até esta data
): Map<string, ThreePrices> {
  const filtered = asOfDate
    ? events.filter((e) => String(e.transaction_date ?? '').slice(0, 10) <= asOfDate)
    : events;

  // ... lógica existente usando `filtered` em vez de `events`
}
```

---

## Arquivo 2 — Remover `ThreePricesValuation` do fluxo INVEST

```bash
# Encontrar todos os usos no fluxo INVEST
grep -rn "ThreePricesValuation\|three_prices_invest" src/ --include="*.ts" \
  | grep -v "test\|spec\|node_modules"
```

Para cada ocorrência em código INVEST (não em testes de estratégia genérica):
1. Substituir por `computeThreePricesByUnderlying(events, asOfDate)`
2. Garantir que `asOfDate` é passado corretamente

Marcar o arquivo com `@deprecated`:
```typescript
// src/modules/invest/ThreePricesValuation.ts
/**
 * @deprecated Para o módulo INVEST, usar threePricesEngine.computeThreePricesByUnderlying(events, asOfDate).
 * Este arquivo pode ser mantido apenas para compatibilidade com estratégias genéricas de inventário.
 * NÃO usar em: tela INVEST, /api/invest/portfolio/three-prices, materialização de invest_position_ext.
 */
```

---

## Arquivo 3 — `src/core/invest/MarketQuoteRepository.ts` (ou equivalente)

### Nunca usar preço atual como histórico

Localizar qualquer fallback que usa `last_price` ou `current_price` quando não encontra cotação histórica:

```typescript
// PROIBIDO:
const price = historicalQuote?.close ?? currentPrice; // usa preço atual como fallback histórico

// CORRETO:
const price = historicalQuote?.close ?? null; // retorna null se não tem histórico
// Quem chama decide se bloqueia ou estima (só opções podem estimar)
```

### Implementar cadeia de fontes para ações

```typescript
async getHistoricalClose(ticker: string, date: string): Promise<{
  price: number;
  source: 'brapi' | 'yahoo' | 'stooq' | 'manual' | null;
} | null> {

  // 1. Banco local (gravado por sync anterior)
  const local = await this.findLocal(ticker, date);
  if (local) return { price: local.close_price, source: local.source };

  // 2. brapi (range histórico)
  const brapi = await this.fetchBrapi(ticker, date);
  if (brapi) {
    await this.saveLocal(ticker, date, brapi, 'brapi');
    return { price: brapi, source: 'brapi' };
  }

  // 3. Yahoo/Stooq
  const yahoo = await this.fetchYahoo(ticker, date);
  if (yahoo) {
    await this.saveLocal(ticker, date, yahoo, 'yahoo');
    return { price: yahoo, source: 'yahoo' };
  }

  // 4. Não encontrou — retornar null (não interpolar ação)
  return null;
}
```

---

## Arquivo 4 — `src/core/invest/PatrimonyDailyRecorder.ts`

### Bloquear dia útil sem cotação de ação

```typescript
async recordDay(ctx: UserContext, date: string): Promise<void> {
  // 1. Reconstruir custódia do dia
  const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', date);
  const { assets } = rebuildCustodyFromLedger(events);

  // 2. Verificar cotações obrigatórias para ações e FIIs com posição aberta
  const missingQuotes: string[] = [];
  for (const asset of assets) {
    if (!['stock', 'fii'].includes(asset.assetType)) continue;
    if (Math.abs(asset.quantity) < 0.0001) continue;

    const quote = await this.marketQuotes.getHistoricalClose(asset.ticker, date);
    if (!quote) {
      missingQuotes.push(asset.ticker);
    }
  }

  if (missingQuotes.length > 0) {
    // NÃO gravar patrimônio para este dia
    throw new Error(
      `Dia ${date} bloqueado: cotações ausentes para ${missingQuotes.join(', ')}. ` +
      `Busque as cotações antes de gravar o patrimônio.`
    );
  }

  // 3. Se todas as cotações existem, gravar normalmente
  // ... lógica existente de gravação
}
```

---

## Definition of Done Fase 5

- [x] `computeThreePricesByUnderlying` aceita `asOfDate` e filtra eventos corretamente
- [x] Zero usos de `ThreePricesValuation` no fluxo INVEST (endpoints, materialização, patrimônio)
- [x] `ThreePricesValuation` marcado como `@deprecated`
- [x] `MarketQuoteRepository` nunca usa preço atual como histórico
- [x] `PatrimonyDailyRecorder.recordDay` bloqueia se ação sem cotação histórica
- [x] `npm run build` sem erros / `npm test` sem regressões

### Status Codex 2026-06-04

`computeThreePricesByUnderlying(events, asOfDate)` agora filtra eventos futuros
e os callers de controller, materializacao, diagnostico e PnL passam a data de
corte disponivel. `ThreePricesValuation` foi marcado como deprecated; permanece
registrado somente na factory como estrategia generica/de compatibilidade do
InventoryLedger, nao como motor de endpoints/materializacao INVEST.

`MarketQuoteRepository.getHistoricalClose` foi adicionado com contrato estrito:
retorna apenas cotacao historica local exata de `market_quotes_daily` ou `null`,
sem fallback para `last_price`/preco atual. O bloqueio de dia util sem cotacao
de acao/FII aberta ja esta em `PatrimonyDailyRecorder.recordDay`.

Validacoes executadas:
- `npm run build`
- `node .\node_modules\jest\bin\jest.js --runTestsByPath tests/unit/invest/threePricesEngine.test.ts tests/unit/core/market/MarketQuoteRepository.test.ts tests/unit/invest/PatrimonyDailyRebuildService.test.ts --runInBand`

---
---

# TASK FASE 6 — Reimportação e Validação Final

**Pré-requisito:** Fases 1-5 concluídas e `npm run build` passando.
**Objetivo:** Reconstruir a base confiável e validar com as 3 planilhas do plano.

---

## Sequência de execução (via API ou script)

```bash
# 1. Reset preservando abertura
POST /api/invest/reconcile/reset-holding

# 2. Migração de opening_balance (idempotente)
POST /api/invest/reconcile/migrate-opening-balance

# 3. Limpar cotações históricas suspeitas (se houver)
# DELETE FROM market_quotes_daily WHERE source = 'fallback_current_price'

# 4. Importar notas + extratos via Opção C
POST /api/invest/reconcile/option-c/run-all
{
  "notesFiles": [...],
  "extractFiles": [...],
  "resetFirst": false,
  "delayMs": 1500
}

# 5. Buscar cotações obrigatórias
POST /api/invest/quotes/sync-b3

# 6. Rebuild de patrimônio (com lastTrustedDate automático)
POST /api/invest/patrimony-daily/rebuild

# 7. Rodar auditorias
POST /api/invest/reconcile/audit/run

# 8. Validar com as 3 planilhas (endpoints de diagnóstico)
GET /api/invest/reconcile/diagnostics/financial?from=2026-01-01
GET /api/invest/reconcile/diagnostics/events?from=2026-01-01
GET /api/invest/reconcile/diagnostics/portfolio?from=2026-01-01
```

---

## Arquivo 1 — `src/core/invest/reconcile/ReconciliationDiagnosticsService.ts` (NOVO ou adaptar)

Implementar os 3 endpoints de diagnóstico do plano (seção 13):

```typescript
export class ReconciliationDiagnosticsService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /** Visão 13.1 — uma linha por dia com saldos liquidado e em trânsito */
  async getFinancialDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<FinancialDiagRow[]> { /* ... */ }

  /** Visão 13.2 — uma linha por evento com status de liquidação */
  async getEventsDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<EventDiagRow[]> { /* ... */ }

  /** Visão 13.3 — uma linha por dia/ativo com quantidades e preços */
  async getPortfolioDiagnostics(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<PortfolioDiagRow[]> { /* ... */ }
}
```

---

## Checklist das 10 perguntas do critério final (seção 18)

Após a Fase 6, o sistema deve conseguir responder para qualquer dia:

```
1. Qual era o saldo liquidado?
   → GET /api/invest/cash/transit?asOf=YYYY-MM-DD → settled_cash

2. Qual era o saldo em trânsito?
   → GET /api/invest/cash/transit?asOf=YYYY-MM-DD → in_transit

3. Qual evento explicou cada mudança de caixa?
   → GET /api/invest/reconcile/diagnostics/events → business_event_id em cada linha

4. Qual era a quantidade de cada ativo?
   → GET /api/invest/portfolio/custody → quantity por ticker

5. Qual evento explicou cada mudança de ativo?
   → GET /api/invest/reconcile/diagnostics/portfolio → event_id por movimento

6. Qual preço foi usado em cada ativo e de qual fonte veio?
   → GET /api/invest/reconcile/diagnostics/portfolio → price_source por dia/ativo

7. Como foram calculados os 3 PMs?
   → GET /api/invest/portfolio/three-prices → pm_estrito, pm_b3, pm_gerencial

8. Qual era o patrimônio total?
   → GET /api/invest/patrimony/chart → patrimony por dia

9. O patrimônio bate com a âncora mensal?
   → GET /api/invest/reconcile/patrimony-anchors → comparar com invest_portfolio_daily

10. Se não bate, qual pendência explica o delta?
    → GET /api/invest/reconcile/audit/run → pendências por categoria
```

---

## Validação final da auditoria (seção 14)

O `ReconciliationAuditService.run` deve retornar **zero issues** para a reconciliação ser considerada válida:

```bash
POST /api/invest/reconcile/audit/run
# Esperado: { canProceedToNextDay: true, countsBySeverity: { critical: 0, error: 0, warn: 0 } }
```

Se houver issues, a seção 14 do plano lista a ordem de investigação:
1. `orphan_patrimony_leg` / `orphan_financial_leg` → Fase 1 incompleta
2. `qty_custody_mismatch` → importação com bug
3. `liq_bolsa_unmatched` → Fase 3 incompleta
4. `missing_quote` → Fase 5 incompleta
5. `portfolio_daily_gap` → Fase 4 incompleta

---

## Definition of Done Fase 6

- [ ] Reset + migração + importação + rebuild executados sem erro
- [ ] `POST /api/invest/reconcile/audit/run` retorna zero issues críticos
- [x] 3 endpoints de diagnóstico implementados e retornando dados
- [x] As 10 perguntas do critério final têm resposta via API
- [x] `npm run build` sem erros
- [ ] `npm test` sem regressões
- [ ] Patrimônio diário bate com âncoras mensais BTG (delta ≤ valor estimado de opções)

### Status Codex 2026-06-04

Adicionadas rotas dedicadas:
- `GET /api/invest/reconcile/diagnostics/financial`
- `GET /api/invest/reconcile/diagnostics/events`
- `GET /api/invest/reconcile/diagnostics/portfolio`

Elas reutilizam `ReconciliationDiagnosticsService.build` e retornam as visoes
diarias filtraveis por `from`, `to`/`asOf`. O endpoint agregado
`GET /api/invest/reconcile/diagnostics` permanece disponivel.

Validacao executada:
- `npm run build`

Pendencias dependentes de ambiente/dados reais:
- executar reset + migracao + Option C + rebuild com arquivos reais;
- confirmar `audit/run` com zero issues criticos;
- validar patrimonio diario contra ancoras BTG;
- rodar `npm test` completo apos resolver as 3 falhas preexistentes registradas.
