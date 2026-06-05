# Avaliação Completa — Funcionalidade de Conciliação INVEST
**Data:** 05/06/2026 | Baseado na leitura direta de todos os arquivos do Drive

## Status pos-correcao Codex 2026-06-05

- C1 aplicado: `DEFAULT_OPENING_BALANCE` removido. O extrato usa `Saldo Inicial` do arquivo ou `LedgerImportService.getOpeningLedgerBalance(ctx)`.
- C2 aplicado: notas BTG sempre suprimem pernas financeiras de caixa; caixa canonico vem do extrato/LIQ BOLSA.
- C3 verificado: `OptionCDailyCloseOrchestrator.finishExtractsPhase` usa `applyBtgExtractBatchUpload`, que chama `applyBtgExtractUpload`.
- C4 verificado/ajustado: metodo publico canonico e `settleLiqBolsa`, delegando para `LiqBolsaSettlementService.settle()`. O nome `settleUqBolsa` no texto abaixo e typo legado.
- C5 aplicado: qualquer `openingChainOk === false` bloqueia o batch; ajuste automatico de caixa continua desativado.
- Debito medio tratado: `ReconciliationSessionService` agora bloqueia `phase: cash` legado para evitar um caminho sem processamento de extratos/LIQ BOLSA. Use Opcao C ou importacao batch de extratos.

---

## 1. Mapa do Pipeline Completo

```
NOTAS BTG (PDF)
  └─ applyBtgBrokerageUpload
       ├─ brokerageNotesToLedgerLines(kept)          ← gera pernas patrimoniais
       ├─ suppressBrokerageNoteCashLines (opcional)   ← remove pernas de caixa se cashFromExtractOnly=true
       └─ ledger.importEntriesOnly → reconcileCustody

EXTRATOS BTG (PDF/CSV/TXT)
  └─ applyBtgExtractUpload
       ├─ parseExtractUploadImportLines(includeLiqBolsa: true)
       │    └─ classifyBtgDescription → pending_settlement para LIQ BOLSA
       ├─ settleUqBolsaEntries
       │    └─ ledger.settleUqBolsa → LiqBolsaSettlementService.settle()
       │         ├─ matched → cria perna cleared + cancela pending
       │         └─ unresolved → BLOQUEIA importação
       ├─ ledger.importEntriesOnly (entradas sem LIQ BOLSA)
       └─ reconcileCustody

LOTE DE EXTRATOS (batch)
  └─ applyBtgExtractBatchUpload
       ├─ ordena por mês (cronológico)
       ├─ valida cadeia de saldos entre meses
       │    └─ openingChainOk === false && delta ≠ 0 → BLOQUEIA
       └─ chama applyBtgExtractUpload por arquivo

OPÇÃO C (reimport completo)
  └─ OptionCDailyCloseOrchestrator
       ├─ resetFirst opcional → HoldingPurgeKeepOpeningService
       ├─ Fase NOTAS: fecha pregão a pregão
       │    ├─ importEntriesOnly(dayLines) + reconcileCustody
       │    └─ materializeDay (cotações + 3 preços)
       └─ Fase EXTRATOS: finishExtractsPhase
            ├─ importa arquivos de extrato (via applyBtgExtractUpload?)
            └─ patrimonyRebuild.rebuild()
```

---

## 2. O Que Está Correto e Funcionando

### ✅ LIQ BOLSA — fluxo completo implementado

```typescript
// applyBtgExtractUpload (btgUploadImportService.ts)
const parseOptions = { includeLiqBolsa: true };
let entries = await parseExtractUploadImportLines(file, parseOptions);
const liqBolsaSettlement = await settleUqBolsaEntries(ctx, ledger, entries);
entries = liqBolsaSettlement.entries; // remove LIQ BOLSA das entradas

if (liqBolsaSettlement.unresolved.length) {
  return { importOk: false, importError: `LIQ BOLSA sem casamento...` }; // bloqueia
}
```

O pipeline é: parsear → identificar LIQ BOLSA → `LiqBolsaSettlementService.settle()` → casado = cria cleared + cancela pending → não casado = **bloqueia** a importação inteira. Correto.

### ✅ Cadeia de saldos entre meses

O batch valida continuidade entre extratos:
```typescript
if (openingChainOk === false && openingChainDelta !== 0) {
  importOk: false, importError: 'Cadeia de saldos quebrada...'
}
```
Importação de extrato de fevereiro não passa se o saldo de abertura não bate com o fechamento de janeiro.

### ✅ `injectCashAdjustment` bloqueado

Ajuste automático de divergência foi desativado com mensagem explícita:
```typescript
if (options?.injectCashAdjustment) {
  return { importOk: false, importError: 'Importacao bloqueada: ajuste automatico de divergencia foi desativado.' }
}
```

### ✅ `reconcileCustody` ao final de cada importação

Tanto `applyBtgBrokerageUpload` quanto `applyBtgExtractUpload` chamam `ledger.reconcileCustody(ctx)` no final.

### ✅ `LiqBolsaSettlementService` — algoritmo correto

Subset sum determinístico com n ≤ 20, detecção de ambiguidade, idempotência via `external_ref`, cancelamento correto das pernas `pending`.

### ✅ Mês já importado não reimporta

```typescript
if (recon.monthAlreadyImported) {
  return { importOk: false, importError: `Mês ${recon.month} já possui lançamentos BTG-EXT no livro.` }
}
```

---

## 3. Problemas Identificados

### ❌ CRÍTICO — `DEFAULT_OPENING_BALANCE = 58_758.79` hardcoded

```typescript
// btgUploadImportService.ts linha ~17
const DEFAULT_OPENING_BALANCE = 58_758.79;
```

Um valor monetário específico hardcoded em código de produção. Viola a doutrina "zero hardcode" documentada em `AI_HANDOFF.md`. Se o saldo inicial da conta mudar (novo cliente, novo período), este valor produz dados silenciosamente errados.

**Correção:**
```typescript
// Remover a constante hardcoded. Buscar do banco:
async function resolveOpeningBalance(
  ctx: UserContext,
  ledger: LedgerImportService,
  extractedFromFile: number | null
): Promise<number> {
  if (extractedFromFile != null) return extractedFromFile;
  // Buscar perna de abertura do ledger
  const openingLeg = await ledger.getOpeningLedgerBalance(ctx);
  if (openingLeg != null) return openingLeg;
  throw new GatewayError(
    'MISSING_OPENING_BALANCE',
    'Saldo inicial não encontrado. Execute a migração de abertura antes de importar extratos.',
    400
  );
}
```

### ❌ CRÍTICO — Notas criam pernas de caixa com `status: 'cleared'` por padrão

`applyBtgBrokerageUpload` só suprime pernas de caixa quando `cashFromExtractOnly: true` é passado explicitamente. Sem esse flag, as notas criam pernas de caixa `cleared` imediatamente, antes do extrato confirmar via LIQ BOLSA.

Isso significa que no fluxo padrão:
- Nota → cria perna de caixa `cleared` (errado — devia ser `pending`)
- Extrato LIQ BOLSA → `LiqBolsaSettlementService` cria nova perna `cleared` + cancela a `pending`

Com notas criando `cleared`, o `LiqBolsaSettlementService` não encontra pernas `pending` para casar e retorna `blocked`. Resultado: **importação de extrato bloqueia sempre** quando notas foram importadas sem `cashFromExtractOnly: true`.

**Correção:**
```typescript
// applyBtgBrokerageUpload — sempre suprimir pernas de caixa das notas
// O caixa vem do extrato via LIQ BOLSA, nunca da nota
let entries = brokerageNotesToLedgerLines(kept);
entries = suppressBrokerageNoteCashLines(entries); // ← sempre, não opcional
```

Ou, se `cashFromExtractOnly` for opcional por design, documentar explicitamente que deve ser `true` no fluxo canônico e que `false` é apenas para casos legados.

### ⚠️ ALTO — `OptionCDailyCloseOrchestrator` não foi atualizado para Fase 3

O orquestrador foi modificado pela última vez em `2026-06-04T00:23:51` — antes das mudanças das Fases 2 e 3 (`btgUploadImportService.ts` modificado às 21:42).

**Risco:** a fase de extratos do orquestrador (`finishExtractsPhase`) pode não estar usando `applyBtgExtractUpload` com `includeLiqBolsa: true`. Se o orquestrador usa sua própria lógica de importação de extratos sem passar pelo `settleUqBolsaEntries`, o LIQ BOLSA não será processado na Opção C.

**Verificar:**
```bash
grep -n "applyBtgExtractUpload\|applyBtgExtractBatch\|includeLiqBolsa\|settleUqBolsa" \
  src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts
```
Se não aparecer nada → a Opção C está usando o pipeline antigo sem LIQ BOLSA.

### ⚠️ ALTO — `ledger.settleUqBolsa` — verificar se existe em `LedgerImportService`

`settleUqBolsaEntries` chama `ledger.settleUqBolsa(ctx, {...})`. O arquivo `LedgerImportService.ts` (modificado 2026-06-04T12:07:25) precisa ter esse método. Se não existir, toda importação de extrato que contém LIQ BOLSA lança `TypeError: ledger.settleUqBolsa is not a function`.

**Verificar:**
```bash
grep -n "settleUqBolsa\|LiqBolsaSettlementService" \
  src/core/invest/LedgerImportService.ts
```
Esperado: método `async settleUqBolsa(ctx, input)` delegando para `LiqBolsaSettlementService`.

### ⚠️ MÉDIO — `openingChainDelta === null` não bloqueia

```typescript
if (openingChainOk === false && openingChainDelta !== null && openingChainDelta !== 0) {
  // bloqueia
}
```

Se `openingChainOk === false` mas `openingChainDelta === null` (dado ausente), a importação não bloqueia. Caso marginal, mas pode deixar um extrato com saldo inicial desconhecido passar.

**Correção:**
```typescript
if (openingChainOk === false) { // simplificar — qualquer falha na cadeia bloqueia
  // bloqueia
}
```

### ⚠️ MÉDIO — `ReconciliationSessionService.ts` não atualizado (May 30)

O serviço de sessão de conciliação — que implementa o fluxo `session/start → session/day/resolve → session/day/close` — não foi atualizado desde 30/05. As mudanças de Fases 1-3 (businessEventId obrigatório, CashBalanceService, LiqBolsaSettlementService) não estão refletidas nele.

Se alguém usar o fluxo de sessão em vez da Opção C, vai cair no pipeline antigo.

---

## 4. Tasks de Correção para os Agentes

### Task C1 — Remover hardcode de saldo inicial (CRÍTICO)

**Arquivo:** `src/core/invest/btgUploadImportService.ts`

Remover:
```typescript
const DEFAULT_OPENING_BALANCE = 58_758.79;
```

Substituir o uso em `buildExtractPreview` e `applyBtgExtractUpload` por:
```typescript
const openingBalance = extractOpeningBalance(lines)
  ?? await ledger.getOpeningLedgerBalance(ctx)
  ?? (() => { throw new GatewayError('MISSING_OPENING_BALANCE',
      'Saldo inicial não encontrado no extrato nem no livro. ' +
      'Execute POST /invest/reconcile/migrate-opening-balance primeiro.', 400); })();
```

Adicionar `getOpeningLedgerBalance` em `LedgerImportService`:
```typescript
async getOpeningLedgerBalance(ctx: UserContext): Promise<number | null> {
  const legs = await this.gateway.findWhere(ctx, 'financial_ledger_entries', {
    status: 'cleared',
  }, {
    extraWhere: "external_ref LIKE 'OPENING-CASH-%'",
    limit: 1,
  });
  if (!legs.length) return null;
  const leg = legs[0]!;
  const sign = leg.direction === 'outflow' ? -1 : 1;
  return Math.round(Number(leg.amount) * 100 * sign) / 100;
}
```

### Task C2 — Suprimir pernas de caixa das notas (CRÍTICO)

**Arquivo:** `src/core/invest/btgUploadImportService.ts`

Em `applyBtgBrokerageUpload`, garantir que `suppressBrokerageNoteCashLines` é sempre aplicado:
```typescript
let entries = brokerageNotesToLedgerLines(kept);
// SEMPRE suprimir caixa das notas — caixa vem exclusivamente do extrato via LIQ BOLSA
entries = suppressBrokerageNoteCashLines(entries);
// Remover o parâmetro cashFromExtractOnly — não é mais opcional
```

Remover o `if (options?.cashFromExtractOnly)` e aplicar incondicionalmente.

### Task C3 — Verificar e atualizar `OptionCDailyCloseOrchestrator`

**Arquivo:** `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`

1. Verificar se `finishExtractsPhase` usa `applyBtgExtractUpload` ou `applyBtgExtractBatchUpload`
2. Se usa, confirmar que `includeLiqBolsa: true` está no fluxo
3. Se usa `importEntriesOnly` diretamente, substituir pelo pipeline completo:

```typescript
// Em finishExtractsPhase, ao processar extratos:
// ANTES (se for assim):
await this.ledger.importEntriesOnly(ctx, extractEntries, { sourceLabel: '...' });

// DEPOIS:
for (const extractFile of rt.state.extractFiles) {
  await applyBtgExtractUpload(ctx, this.ledger, extractFile);
}
```

### Task C4 — Verificar `LedgerImportService.settleUqBolsa`

```bash
grep -n "settleUqBolsa\|LiqBolsaSettlementService" \
  src/core/invest/LedgerImportService.ts
```

Se não existir, adicionar:
```typescript
// Em LedgerImportService.ts
import { LiqBolsaSettlementService } from './LiqBolsaSettlementService';
import type { LiqBolsaSettlementInput } from './LiqBolsaSettlementService';

private readonly liqBolsaSettler: LiqBolsaSettlementService;

// No constructor:
this.liqBolsaSettler = new LiqBolsaSettlementService(gateway);

// Método público:
async settleUqBolsa(
  ctx: UserContext,
  input: LiqBolsaSettlementInput
) {
  return this.liqBolsaSettler.settle(ctx, input);
}
```

### Task C5 — Simplificar verificação de cadeia quebrada

**Arquivo:** `src/core/invest/btgUploadImportService.ts`

```typescript
// ANTES:
if (openingChainOk === false && openingChainDelta !== null && openingChainDelta !== 0) {

// DEPOIS:
if (openingChainOk === false) {
```

---

## 5. Resumo Executivo

| Componente | Status | Criticidade |
|---|---|---|
| LIQ BOLSA → `LiqBolsaSettlementService` | ✅ Implementado | — |
| Subset sum determinístico | ✅ Correto | — |
| Bloquear se LIQ BOLSA não casa | ✅ Correto | — |
| Cadeia de saldos entre meses | ✅ Correto | — |
| `injectCashAdjustment` desativado | ✅ Correto | — |
| `DEFAULT_OPENING_BALANCE` hardcoded | ❌ Bug | CRÍTICO |
| Notas criam caixa `cleared` sem extrato | ❌ Bug | CRÍTICO |
| `OptionCDailyCloseOrchestrator` não atualizado | ⚠️ Risco | ALTO |
| `ledger.settleUqBolsa` — verificar existência | ⚠️ Risco | ALTO |
| Cadeia quebrada com delta `null` não bloqueia | ⚠️ Gap | MÉDIO |
| `ReconciliationSessionService` não atualizado | ⚠️ Débito | MÉDIO |

**Prioridade de execução:** C2 (suprimir caixa das notas) → C1 (remover hardcode) → C4 (verificar método) → C3 (orquestrador) → C5 (cadeia null).

C2 e C1 devem ser feitas juntas — ambas são pré-requisito para que o LIQ BOLSA consiga encontrar as pernas `pending` das notas para casar.
