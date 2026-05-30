# INVEST — Conciliação BTG e reconstrução do patrimônio diário

> **Autor:** arquitetura · **Status:** plano para execução por agentes  
> **Substitui:** telas removidas `Extratos de conta`, `Importar mês BTG`, `Importar fontes BTG (lote)`  
> **Arquitetura avançada (ler primeiro):** [`invest_reconciliacao_sessao.md`](invest_reconciliacao_sessao.md) — sessão, dia a dia, varredura, materialização progressiva  
> **Referências:** [`AI_HANDOFF.md`](AI_HANDOFF.md), [`nucleo_patrimonial.md`](nucleo_patrimonial.md), [`tasks/wave-2/01-engine-tres-precos.md`](../../tasks/wave-2/01-engine-tres-precos.md)

---

## 1. Problema e objetivo

### 1.1 Situação atual

O **Resultado histórico** (`/invest`, `InvestDashboardPage`) consome `GET /api/invest/patrimony-daily?method=mtm_btg`. A curva é montada assim:

1. Replay do **livro razão** (`patrimony_ledger_entries` + `financial_ledger_entries` → `LedgerEvent[]`).
2. Motor **`buildBtgAnchorPatrimonyDailyResult`** ou **`buildDailyPatrimonyMtmSeries`** com calibração às âncoras mensais BTG quando existem (`invest_patrimony_monthly_anchors`).
3. **Mescla** com fechamentos já gravados em `invest_portfolio_daily` (cron 23h / `recordDay`).
4. TWR e índice 100 no gráfico vêm de `computePortfolioPerformance` + `mergeStoredPatrimonySeries` + `resolvePortfolioIndexedForChart`.

O gráfico está **errado** porque a cadeia inteira depende de um livro inconsistente:

| Camada | Sintoma típico |
|--------|----------------|
| Livro | Duplicatas, caixa sem vínculo à nota, LIQ BOLSA importada em duplicidade, taxas faltando |
| Fechamentos gravados | `invest_portfolio_daily` reflete livro antigo; `invalidateFromDate` só roda parcialmente no import |
| Âncoras BTG | Curva “esticada” para bater patrimônio publicado BTG, mascarando erro do livro |
| Cotações | Dias sem `market_quotes_daily` caem em PM estático → patrimônio MTM distorcido |

### 1.2 Objetivo do produto

**Fluxo obrigatório** (detalhe em [`invest_reconciliacao_sessao.md`](invest_reconciliacao_sessao.md)):

1. Usuário informa **pasta local com todas as notas** (PDF) até o momento.
2. **Primeiro:** conciliação de ativos **dia a dia** (pregão), em ordem cronológica — corrige o livro patrimonial e os três preços.
3. **Depois:** pasta de **extratos** — conciliação bancária dia a dia (caixa ↔ movimentações).
4. A cada dia **fechado**, o sistema **materializa** custódia + `invest_portfolio_daily` até essa data → carteira e **Resultado histórico** passam a refletir a realidade **sem esperar** o fim de todos os PDFs.

| Fase | Pasta | Quando |
|------|-------|--------|
| **1 — Notas** | PDFs notas de corretagem | Sempre primeiro |
| **2 — Extrato** | PDF/CSV conta corrente | Só após fase 1 concluída |

UI: **wizard simples** (`/invest/conciliacao`) — barra de progresso por dia, duas tabelas com →/←, painel de varredura. Não importação em lote cega: preview + fechamento de dia.

---

## 2. Princípios inegociáveis (regras do projeto)

1. **Fonte única:** livro razão (`business_events` + pernas). Sem arquivo em `data/invest/**`.
2. **Parser → barramento canônico → engine:** reutilizar `btgBrokerageNoteParser`, `BtgExtractLineParser`, `brokerageNotesToLedgerLines`, `btgLinesToImportEntries` — não duplicar lógica na UI.
3. **Gateway:** mutações via `CoCeoDataGateway` / `InvestOperations.recordOperation` — nunca `pool.query` em controller.
4. **Sem hardcode de ticker/data/âncora** na UI; período via `GET /api/invest/ui-context`.
5. **Exclusão no livro:** `soft_delete` em pernas/eventos (padrão `InvestOperations`), não DELETE físico salvo purge administrativo documentado.
6. **Gráfico pós-conciliação:** método canônico de exibição = **patrimônio econômico** (livro × cotação do dia). Âncoras BTG = **linha de referência**, não deformação da curva principal.

---

## 3. Arquitetura em camadas

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UI (Solid/Vanilla legado)                                              │
│  InvestConciliacaoBancariaPage   InvestConciliacaoAtivosPage            │
│  InvestDashboardPage (gráfico — só leitura, pós-rebuild)                 │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ REST
┌───────────────────────────────▼─────────────────────────────────────────┐
│  InvestController — rotas /api/invest/reconcile/*                       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌────────────────────┐    ┌─────────────────────────┐
│ Reconcile     │    │ Reconcile          │    │ PatrimonyDailyRebuild   │
│ CashService   │    │ AssetsService      │    │ Service                 │
│ (extrato)     │    │ (notas)            │    │ (pós-mutação livro)     │
└───────┬───────┘    └─────────┬──────────┘    └───────────┬─────────────┘
        │                      │                           │
        ▼                      ▼                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Existente: btgUploadImportService, LedgerImportService,              │
│  buildBrokerageNoteReviewRows, computeThreePricesByUnderlying,        │
│  PatrimonyDailyRecorder, PatrimonyDailyStore.invalidateFromDate         │
└───────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  MySQL: patrimony_ledger_entries, financial_ledger_entries,             │
│  business_events, invest_portfolio_daily, market_quotes_daily         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 4. Modelo de conciliação (linha a linha)

### 4.1 Identidade estável (`ReconcileRowId`)

Cada linha exibida nas tabelas carrega um `rowKey` determinístico para diff e idempotência:

| Origem | `rowKey` (exemplo) |
|--------|---------------------|
| Livro financeiro | `fin:{financial_ledger_entry.id}` |
| Livro patrimonial | `pat:{patrimony_ledger_entry.id}` |
| Extrato parseado | `ext:{sha256(fileName+date+description+signedAmount+balance)}` |
| Nota — trade | `note:{noteNumber}:{pregaoDate}:{lineNo}` |
| Nota — líquido caixa | `note-net:{noteNumber}:{pregaoDate}` |

### 4.2 Status de batimento

```ts
type ReconcileStatus =
  | 'matched'      // par livro ↔ arquivo, valores dentro da tolerância
  | 'different'    // mesma chave lógica, valor/data divergente
  | 'ledger_only'  // só no banco
  | 'file_only'    // só no arquivo
  | 'skipped'      // LIQ BOLSA agregado, linha informativa sem lançamento
  | 'blocked';     // mês já fechado / abertura protegida
```

Tolerância monetária padrão: **R$ 0,02** (já usada em `getExtract` e batimento de notas).

### 4.2.1 Divergência = decisão do usuário (v1)

Qualquer status que não seja `matched` ou `skipped` **confirmado** gera `ReconcileDecision` na fila do dia. O sistema **não** aplica correção automática (sem inferir vínculo, sem insert em lote silencioso, sem “aceitar aviso”).

| Status preview | Na tela | Ações típicas (usuário escolhe) |
|----------------|---------|----------------------------------|
| `different` | Destaque + delta R$/qty | Parear, void, reinserir do arquivo |
| `file_only` | Só na coluna arquivo | Inserir no livro |
| `ledger_only` | Só na coluna livro | Void / parear com nota futura |
| `blocked` | Mensagem explícita | Nenhuma até remover bloqueio (abertura) |

Detalhe completo: [`invest_reconciliacao_sessao.md`](invest_reconciliacao_sessao.md) §J.

### 4.3 Chave de pareamento

**Bancária (extrato ↔ caixa):**

- Primário: `BTG-EXT-{date}#{seq}` em `external_ref` / metadata.
- Secundário: `transaction_date` + `round(signedAmount, 2)` + classificação (`classifyBtgDescription`).
- Terciário (manual): usuário seleciona linha esquerda + direita → API `POST .../pair` grava vínculo em metadata (`reconcile_pair_id`).

**Ativos (nota ↔ patrimônio + caixa):**

- Primário: `broker_note_ref` / `BTG-NOTA-{noteNumber}` (`event_source_ref`).
- Cruzamento caixa: `buildNotesTradeSummary` (já em `InvestController.getExtract`) — líquido da nota vs perna `CAIXA-*` na data de liquidação (`cashSettlementDate`).

---

## 5. APIs novas (contrato REST)

Todas exigem `invest:ledger:read` (preview) ou `invest:ledger:write` (apply). Personificação da org obrigatória.

### 5.1 Conciliação bancária

| Método | Rota | Corpo | Resposta |
|--------|------|-------|----------|
| POST | `/api/invest/reconcile/cash/preview` | `{ files: BtgUploadFileInput[] }` | `{ summary, ledgerRows[], fileRows[], pairs[] }` |
| POST | `/api/invest/reconcile/cash/apply-insert` | `{ rowKeys: string[] }` | `{ inserted, skipped, rebuild }` |
| POST | `/api/invest/reconcile/cash/apply-delete` | `{ ledgerEntryIds: string[] }` | `{ deleted, rebuild }` |
| POST | `/api/invest/reconcile/cash/pair` | `{ ledgerRowKey, fileRowKey }` | `{ ok }` |

`preview` reutiliza `previewBtgExtractBatchUpload` + projeção das pernas `financial_ledger_entries` (via `LedgerEventProjection` ou query DAL `financial_ledger_cash_range`).

**LIQ BOLSA:** aparece em `fileRows` com `status: 'skipped'`, `importable: false` (regra `classifyBtgDescription` / script `reconcile-cash-extract-daily.ts`).

### 5.2 Conciliação de ativos

| Método | Rota | Corpo | Resposta |
|--------|------|-------|----------|
| POST | `/api/invest/reconcile/assets/preview` | `{ files: BtgUploadFileInput[] }` | `{ summary, ledgerRows[], fileRows[], pmByUnderlying }` |
| POST | `/api/invest/reconcile/assets/apply-insert` | `{ rowKeys: string[] }` | `{ inserted, skipped, enriched, rebuild }` |
| POST | `/api/invest/reconcile/assets/apply-delete` | `{ patrimonyEntryIds[], financialEntryIds[] }` | `{ deleted, rebuild }` |

`ledgerRows` no preview estende o formato de `buildBrokerageNoteReviewRows` com:

- `ledgerEntryId`, `reconcileStatus`, `pmEstrito`, `pmB3`, `pmGerencial` (de `computeThreePricesByUnderlying` **simulado** após merge virtual das linhas `file_only` — modo dry-run no engine, ver §6.3).
- `cashLegLinked: boolean`, `cashSettlementDelta`.

`apply-insert` chama `LedgerImportService.importEntriesOnly` (notas) com `cashFromExtractOnly: true` quando extrato já governa o caixa.

### 5.3 Rebuild do patrimônio diário (crítico para o gráfico)

| Método | Rota | Corpo | Resposta |
|--------|------|-------|----------|
| POST | `/api/invest/patrimony-daily/rebuild` | `{ from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', force?: boolean }` | `{ from, to, daysWritten, quotesCoverage, warnings[] }` |
| GET | `/api/invest/patrimony-daily/rebuild-status` | — | `{ lastRebuildAt, from, to, inProgress }` |

**Comportamento de `rebuild`:**

```
1. from ← max(periodMin, from, data da primeira mutação no lote)
2. PatrimonyDailyStore.invalidateFromDate(org, from)
   → DELETE invest_portfolio_daily + invest_daily_snapshots WHERE date >= from
3. ledger.listLedgerEvents(org, from, to)
4. Garantir market_quotes_daily no intervalo (sync se faltar — best effort, log warning)
5. Para cada dia útil em [from..to]:
     PatrimonyDailyRecorder.recordDay(org, date)
     → grava invest_portfolio_daily com source = 'mtm_economic'
6. reconcileCustody(org)
7. Retornar resumo + warnings (dias sem cotação, external flows não classificados)
```

`apply-insert` / `apply-delete` nas telas de conciliação **devem chamar `rebuild` automaticamente** com `from = minDate(alterações)`.

### 5.4 Ajuste do gráfico (Resultado histórico)

Alterar contrato de leitura (sem remover `mtm_btg`):

| Parâmetro `method` | Uso |
|------------------|-----|
| `mtm_economic` | **Padrão novo** — livro × `market_quotes_daily`, sem calibrar curva em âncoras |
| `ledger_replay` | Auditoria — motor legado D+2 (`buildDailyPatrimonySeries`) |
| `mtm_btg` | Opcional — curva calibrada + referência publicada BTG (não default) |

UI `InvestDashboardPage`: trocar query de `method=mtm_btg` para `method=mtm_economic`.

Exibir badge: “Fechamentos: N dias · Último rebuild: …” via `rebuild-status`.

---

## 6. Serviços de domínio (novos arquivos)

### 6.1 `src/core/invest/reconcile/ReconcileCashService.ts`

Responsabilidades:

- `preview(ctx, files)` → parse extrato, carregar caixa do livro, `matchRows`, `buildExtractReconcileFields` por mês.
- `applyInsert(ctx, fileRowKeys)` → `assignExtractRefs` + `importEntriesOnly` só linhas selecionadas.
- `applyDelete(ctx, ids)` → `InvestOperations.voidEvent` ou soft delete em lote via gateway.

Reutilizar: `previewBtgExtractBatchUpload`, `applyBtgExtractBatchUpload` (fatia por linha — **novo** helper `importExtractLinesSelected` se lote completo for pesado).

### 6.2 `src/core/invest/reconcile/ReconcileAssetsService.ts`

Responsabilidades:

- `preview(ctx, files)` → `previewBtgBrokerageUpload` + diff com `buildBrokerageNoteReviewRows`.
- Enriquecer com `computeThreePricesByUnderlying` e projeção de caixa por nota.
- `applyInsert` / `applyDelete` delegando a `applyBtgBrokerageUpload` / void de eventos.

### 6.3 `src/core/invest/PatrimonyDailyRebuildService.ts`

Orquestra §5.3. Único lugar que chama `invalidateFromDate` + loop `recordDay`.

**Importante:** `PatrimonyDailyRecorder.recordDay` hoje mistura âncora BTG no valor gravado (`mtm_btg_calibrated`). Para rebuild pós-conciliação:

- Gravar fechamentos com `source: 'mtm_economic'` **sempre** no rebuild.
- Manter `metadata.btgPatrimony` só como referência auditável.
- `getPatrimonyDaily` com `method=mtm_economic` usa `filterStoredDaysForChartMethod` → `source === 'mtm_economic'`.

Isso **desacopla** o gráfico principal da distorção por âncora.

### 6.4 Simulação de PM no preview (opcional fase 2)

Para mostrar PM “como ficaria” se inserir linhas do arquivo:

- Clonar `LedgerEvent[]` + aplicar linhas virtuais `file_only` em memória.
- Rodar `computeThreePricesByUnderlying(simulatedEvents)`.
- Não persistir.

---

## 7. UI — layout validado com o arquiteto

### 7.1 Conciliação Bancária (`/invest/conciliacao-bancaria`)

```
[ Escolher pasta/arquivos PDF/CSV ]  [ Analisar ]  [ Limpar ]
Resumo: N arquivo(s) · X batidas · Y diferentes · Z só extrato · W só livro

Filtros: Todas | Diferentes | Só arquivo | Só livro | Batidas

┌─ Livro (caixa) ─────────────┐  ┌→┐  ┌─ Extrato (arquivo) ────────┐
│ ☐ Data │ Entr/Saída │ Saldo  │  │←│  │ ☐ Data │ Entr/Saída │ Saldo │
│ ...                         │  └─┘  │ ...                         │
└─────────────────────────────┘       └─────────────────────────────┘

[ Inserir marcados (→) ]  [ Excluir marcados (←) ]  [ Parear seleção ]

Após apply: toast "Rebuild patrimônio: 142 dias gravados"
```

Colunas alinhadas à antiga `InvestExtratosPage` + coluna Batimento + checkbox.

### 7.2 Conciliação de Ativos (`/invest/conciliacao-ativos`)

Mesmo padrão de duas tabelas. Colunas da antiga `InvestHistoricoOperacoesPage` + PM Estrito/B3/Gerencial + vínculo caixa.

Diretório: **somente PDF** de notas. Segundo bloco opcional na mesma tela (fase 2): link “Abrir conciliação bancária” se extrato ainda não batido.

### 7.3 Resultado histórico (ajuste)

- Gráfico usa série `mtm_economic` rebuildada.
- Card de diagnóstico (collapsible): dias sem cotação, último rebuild, divergência vs âncora BTG (somente leitura).

---

## 8. Ordem de execução recomendada (agentes)

| Task ID | Entrega |
|---------|---------|
| CONC-00 | `PatrimonyDailyRebuildService` + dashboard `mtm_economic` |
| CONC-10 | Schema sessão conciliação |
| CONC-11 | `ReconciliationAuditService` (varredura) |
| CONC-12 | `ReconciliationSessionService` + API |
| CONC-13 | UI wizard (notas, dia a dia) |
| CONC-14 | Fase extrato |
| CONC-15 | Catálogo UI + deploy |

**Plano vigente:** [`invest_reconciliacao_sessao.md`](invest_reconciliacao_sessao.md) §G.

**CONC-00 + CONC-10 + CONC-11** em paralelo → **CONC-12** → **CONC-13** → **CONC-14** → **CONC-15**.

---

## 9. Critérios de aceite globais

```bash
npx tsc --noEmit
npx jest tests/unit/invest/reconcile --passWithNoTests
npx jest tests/unit/invest/PatrimonyDailyRebuildService.test.ts
```

Manual (holding personificada):

1. Abertura 01/01/2026 preservada após purge parcial.
2. Preview extrato: linha `file_only` → inserir com → → aparece no livro; rebuild roda; gráfico `/invest` muda a partir da data.
3. Excluir lançamento indevido com ←; rebuild; PM na carteira recalcula (`reconcileCustody`).
4. Inserir nota na Conciliação de Ativos; verificar 3 preços em `/invest/portfolio` para o underlying.
5. `invest_portfolio_daily`: todos os dias úteis do período com `source = 'mtm_economic'` após rebuild completo.

---

## 10. O que NÃO fazer nesta onda

- Reintroduzir telas `/invest/importacao*` ou `/invest/extratos`.
- Gravar arquivos PDF/CSV no repositório ou servidor.
- Calibrar a curva principal do gráfico com âncoras BTG (só referência lateral).
- DELETE físico em massa sem preservar abertura `OPENING:2026-01-01`.
- Novas dependências npm sem autorização na task.

---

## 11. Pegadinhas conhecidas

1. **`invalidateFromDate` usa `pool.query` direto** em `PatrimonyDailyStore` — aceito legado; rebuild deve usar o store existente.
2. **Caixa duplicado** — após inserir notas com caixa, preferir `suppressBrokerageNoteCashLines` quando extrato governa (`cashFromExtractOnly: true`).
3. **LIQ BOLSA** — não vira lançamento; detalhe vem das notas.
4. **Mescla stored + computed** — após rebuild, preferir dias gravados `mtm_economic`; evitar misturar `mtm_btg_calibrated` antigos (invalidate apaga).
5. **Cron 23h** — pode regravar após rebuild; documentar que rebuild manual invalida e reescreve.

---

## 12. Mapa de arquivos (referência rápida)

| Ação | Caminho |
|------|---------|
| Criar | `src/core/invest/reconcile/ReconcileCashService.ts` |
| Criar | `src/core/invest/reconcile/ReconcileAssetsService.ts` |
| Criar | `src/core/invest/PatrimonyDailyRebuildService.ts` |
| Criar | `src/core/invest/reconcile/types.ts` |
| Criar | `frontend/src/pages/InvestConciliacaoBancariaPage.js` |
| Criar | `frontend/src/pages/InvestConciliacaoAtivosPage.js` |
| Criar | `frontend/src/styles/invest-conciliacao.css` |
| Modificar | `src/controllers/InvestController.ts` |
| Modificar | `src/routes/api.ts` |
| Modificar | `frontend/src/legacy/legacyRoutes.ts` |
| Modificar | `frontend/src/navigation/menuCatalog.js` |
| Modificar | `frontend/src/pages/InvestDashboardPage.js` |
| Modificar | `src/database/seeds/008_ui_catalog.ts` |
| Testes | `tests/unit/invest/reconcile/*.test.ts`, `PatrimonyDailyRebuildService.test.ts` |

---

*Fim do plano. Specs executáveis em `tasks/wave-conciliacao/`.*
