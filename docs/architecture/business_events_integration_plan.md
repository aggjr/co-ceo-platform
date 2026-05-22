# Integração rastreabilidade carteira ↔ financeiro via `business_events`

> **Documento vivo de plano e estado.** Atualizado a cada sessão de trabalho.
> Se o assistente cair, retomar lendo este arquivo + `git status` + `nucleo_patrimonial.md`.

Última atualização: **2026-05-22 12:18 (UTC-3)** — branch `feat/invest-custody-validation-2026-05`.

---

## 1. Objetivo permanente

Toda movimentação na carteira de ativos gera **1 ou mais** movimentos financeiros e vice-versa. Os dois lados são amarrados pelo mesmo `business_events.id` (header canônico), permitindo:

- **Rastreabilidade bidirecional**  
  Header → todas as pernas; perna → header; nota/NFe → header via `source_ref`.
- **Conciliação**  
  `SUM(financial_legs cleared+pending) ≈ header.total_net` (tolerância 0,01).
- **Imutabilidade + recálculo**  
  Header fechado nunca sofre UPDATE. Correção = nova revisão (`revision_no=N+1`, `supersedes_event_id` aponta a anterior). Estorno = `voided_at` + soft-delete das pernas.
- **Idempotência**  
  `ensureByRef(source_ref)` evita header duplicado em reimport da mesma nota.

Esse é o pilar arquitetural — qualquer write novo nos ledgers deve passar pelo `BusinessEventRegistry` e gravar `business_event_id`.

---

## 2. Dados de entrada (input do mundo real)

| Fonte | Caminho | Parser | Script de import |
|---|---|---|---|
| Extrato bancário BTG | `dados importação/Extrato.txt` (+ `Extrato_debug.txt`) | `src/core/invest/btgExtractPdfText.ts`, `btgExtractCashSeries.ts`, `BtgExtractLineParser` | `scripts/import-btg-extract.ts`, `scripts/import-btg-extract-ledger.ts` |
| Notas de corretagem BTG | `dados importação/documentos_txt_extraidos/004176105_<periodo>/` (5 períodos: jan, fev, mar, abr, abr-mai 2026) | `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`, `btgBrokerageNoteParser` | `scripts/import-btg-brokerage-notes-ledger.ts` |
| Saldo inicial holding | hardcoded / json | — | `scripts/import-opening-2026-01-01.ts` |
| Outras fontes | MyProfit, ordens BTG home broker | — | `scripts/import-myprofit-augusto.ts`, `scripts/import-btg-orders-augusto.ts`, `scripts/import-may20-orders.ts` |

> **Importante**: o usuário informou que esses dados **já foram importados** em sessões anteriores. A migração arquitetural atual mexe em dados que **já estão no banco remoto**.

---

## 3. Estado atual do código (branch `feat/invest-custody-validation-2026-05`)

### Compilação e testes
- `tsc --noEmit`: 0 erros
- 25 testes novos verdes  
  - `tests/unit/core/business-events/BusinessEventRegistry.test.ts` — 9/9  
  - `tests/unit/core/business-events/BusinessEventReconciler.test.ts` — 9/9  
  - `tests/unit/modules/invest/InvestOperations.voidAmend.test.ts` — 7/7
- 53 testes de regressão verdes nas áreas adjacentes (`cashInvestLedger`, `AutoPendingSettlementSync`, `LedgerEventProjection`, `threePricesEngine`, `ThreePricesValuation`, `WeightedAverageValuation`, `TableRegistry`).
- Suíte completa (55 arquivos) NÃO rodou nesta sessão.

### Arquivos novos (não commitados)

| Caminho | O que faz |
|---|---|
| `src/core/business-events/types.ts` | `BusinessEventKind`, `BusinessEventRow`, `CreateBusinessEventInput`, `BusinessEventLegs`, `EventReconciliationReport`, `LegKind` |
| `src/core/business-events/BusinessEventRegistry.ts` | `create / ensureByRef / amend / voidEvent / listLegs / findByLegId / listRevisions / findHead` |
| `src/core/business-events/BusinessEventReconciler.ts` | `reconcileEvent / assertConsistent / findOrphanLegs` |
| `src/core/business-events/index.ts` | barril |
| `src/database/migrations/16_business_events.sql` | CREATE TABLE + ALTER TABLE em patrimony/financial |
| `scripts/apply-migration-remote.js` | Aplica arquivo SQL no remoto via mysql2 |
| `scripts/backfill-opening-business-event.js` | Cria header `OPENING:<date>` e amarra pernas órfãs do opening |
| `scripts/check-business-events.js` | Sanity check (existência da tabela + colunas + count) |
| `scripts/inspect-business-events.js` | Conteúdo dos headers + contagem de órfãos por data |
| `tests/unit/core/business-events/inMemoryGateway.ts` | Fake gateway in-memory pros testes |
| `tests/unit/core/business-events/BusinessEventRegistry.test.ts` | Testes do registry |
| `tests/unit/core/business-events/BusinessEventReconciler.test.ts` | Testes do reconciler |
| `tests/unit/modules/invest/InvestOperations.voidAmend.test.ts` | Testes E2E de void/amend |

### Arquivos modificados (não commitados)

| Caminho | Mudança |
|---|---|
| `src/core/dal/TableRegistry.ts` | registra `business_events` como tabela tenant |
| `src/core/dal/GatewayReadQueries.ts` | 2 read queries pré-aprovadas: `business_event_orphan_patrimony_legs` e `business_event_orphan_financial_legs` |
| `src/core/financial/FinancialLedger.ts` | grava `business_event_id` em `financial_ledger_entries` |
| `src/core/financial/types.ts` | `businessEventId` em `RecordCashMovementInput` |
| `src/core/inventory/InventoryLedger.ts` | grava `business_event_id` + novo método `rebuildAndPersist` |
| `src/core/inventory/types.ts` | `businessEventId` em `RecordMovementInput` |
| `src/core/invest/ledgerTypes.ts` | `business_event_id` opcional em `LedgerImportLine` |
| `src/modules/invest/InvestOperations.ts` | cria/resolve header em todo write + `voidEvent` + `amendEvent` |
| `src/modules/invest/factory.ts` | injeta `BusinessEventRegistry` na construção |

---

## 4. Estado atual do banco remoto

Host: `69.62.99.34` · Banco: `co_ceo_platform` · Usuário: `root`

Verificado em **2026-05-22 12:09**:

- Tabela `business_events` **existe** (24 colunas).
- Coluna `business_event_id` **existe** em `patrimony_ledger_entries` e `financial_ledger_entries`.
- `business_events` tem **1 row** já gravado — **conteúdo a investigar** (`scripts/inspect-business-events.js`).

Conclusão provisória: a migration foi aplicada em sessão anterior, e provavelmente o backfill do `OPENING:2026-01-01` também (mas precisa confirmar contagem de pernas órfãs).

---

## 5. Decisões de design já tomadas

1. **Amend** = soft-delete das pernas antigas + recria pernas novas com nova revisão (`revision_no=N+1`). `patrimony_items` é re-buildado via `InventoryLedger.rebuildAndPersist`.
2. **Void** = soft-delete das pernas + marca header `voided_at`. Igual ao amend mas sem nova revisão.
3. **Conciliação** = `SUM(financial_legs cleared+pending) ≈ header.total_net` com tolerância 0,01. Headers com `total_net=0` (opening) passam se tiverem ≥ 1 perna.
4. **Idempotência do header** = `BusinessEventRegistry.ensureByRef(source_module, source_ref)` devolve o mesmo header em reimport.
5. **Órfãos legítimos** = pernas pré-migração 16 ficam com `business_event_id=NULL`. Após o reset+replay, **zero órfãos** é a meta permanente.
6. **`invest_position_ext` após void** = não é zerado automaticamente (`pm_estrito`, `last_price` continuam). Considerado cache; será recalculado no próximo movimento. Decidido em 2026-05-22.
7. **API do `amendEvent`** = recebe `headerPatch: Partial<CreateBusinessEventInput>` + `lines: LedgerImportLine[]`. Caller monta a lista a partir do parser do reimport.
8. **Separação `event_source_ref` × `broker_note_ref`** (decisão 2026-05-22 13:22):
   - `LedgerImportLine.event_source_ref` (NOVO) — chave do header agregador. Múltiplas linhas da mesma nota carregam o **mesmo** `event_source_ref` → caem todas no mesmo `business_events.id` via `ensureByRef`. Quando vazio, cada linha vira 1 header avulso (cash_movement).
   - `LedgerImportLine.broker_note_ref` — continua sendo a chave de idempotência **da perna individual** (vira `external_ref='BROKER_REF:{ref}'` em `patrimony_ledger_entries` e `financial_ledger_entries`). Único por linha.
   - **Consequência**: nota BTG com N trades + M taxas vira **1 header** com N+M pernas → soma das pernas bate com `total_net` do header diretamente.
9. **Estratégia de header por fonte de dados**:
   - **Notas de corretagem BTG**: `event_source_ref = 'BTG-NOTA-{noteNumber}'` → 1 header por nota.
   - **Extrato bancário BTG**: `event_source_ref` vazio → 1 header avulso (`cash_movement`) por linha (estado de chegada: cada linha do extrato é um fato independente — TED, multa, taxa, IRRF avulso).
   - **Opening 2026-01-01**: `event_source_ref = 'OPENING:2026-01-01'` → 1 header agregador (mesmo padrão que o backfill anterior já tinha criado).

---

## 6. Pendências em ordem

| # | Tarefa | Status | Como retomar |
|---|---|---|---|
| 1 | Inspecionar estado remoto | **OK 12:18** | `node scripts/inspect-business-events.js` (5 patrimony linkadas, 17 órfãs; 1 financial linkada, 71 órfãs; 1 header opening) |
| 2 | **Refator Saída B**: introduzir `event_source_ref` em `LedgerImportLine`, ajustar `InvestOperations.resolveOrCreateEvent`, translator de notas, opening, e testes | **OK 13:30** — 32/32 testes verdes | feito; ver seção 7 |
| 3 | **Reset do banco remoto**: hard-delete em `business_events`, `patrimony_*`, `financial_*`, `invest_position_ext`, `invest_option_ext`, `financial_accounts` | **a fazer** | criar `scripts/reset-invest-tables.js` |
| 4 | **Replay cronológico**: opening → notas BTG → extrato BTG | **a fazer** | rodar os 3 scripts já existentes (já delegam pro `InvestOperations.recordOperation`) |
| 5 | **Validação**: zero pernas órfãs + `Reconciler.assertConsistent` em todos os headers | **a fazer** | criar `scripts/audit-business-events.js` |
| 6 | Commit das mudanças locais | **a fazer** | `git add` dos novos + modificados |
| 7 | Push (opcional) | **a fazer** | `git push` |

## 7. Refator Saída B — plano detalhado

Arquivos a tocar:

| Arquivo | Mudança |
|---|---|
| `src/core/invest/ledgerTypes.ts` | adicionar `event_source_ref?: string` em `LedgerImportLine` |
| `src/modules/invest/InvestOperations.ts` | `resolveOrCreateEvent` usa `line.event_source_ref` (não mais `broker_note_ref`) como chave do header. `broker_note_ref` continua na idempotência da perna |
| `src/core/invest/btgBrokerageNoteLedgerTranslator.ts` | setar `event_source_ref = 'BTG-NOTA-{noteNumber}'` em todas as linhas geradas pela nota |
| `src/core/invest/LedgerImportService.ts` (opening) | setar `event_source_ref = 'OPENING:{date}'` |
| `scripts/import-btg-extract-ledger.ts` | **não mexer** — fica sem `event_source_ref`, cada linha vira 1 header avulso |
| `tests/unit/.../InvestOperations.*` ou novo | teste do agrupamento por `event_source_ref` |
| `docs/architecture/business_events_integration_plan.md` | atualizar este doc com o status |

---

## 7. Como retomar em caso de queda

1. `git status` na branch `feat/invest-custody-validation-2026-05` — confirmar arquivos da seção 3.
2. Ler este documento (seção 6 mostra onde parou).
3. `npx tsc --noEmit` — confirmar que compila.
4. Rodar apenas testes novos (rápido):  
   `npx jest tests/unit/core/business-events tests/unit/modules/invest/InvestOperations.voidAmend.test.ts --no-coverage`
5. Para mexer no banco remoto: setar `REMOTE_DB_PASSWORD` (não persistir em arquivo).

---

## 8. Glossário rápido (sem repetir docs do núcleo)

- **Header / business_event** = o "fato gerador" (uma nota, uma NFe, um dia de extrato).
- **Pernas patrimony** = `patrimony_ledger_entries` que vivem em estoque/custódia.
- **Pernas financial** = `financial_ledger_entries` que vivem em caixa (com `settlement_date` D+N).
- **`source_ref`** = referência ao documento de origem (número da nota, NFe, pedido). Único por `(org, module, ref, revision_no)`.
- **`supersedes_event_id`** = id da revisão anterior. Forma a cadeia de revisões.
- **Órfão** = perna sem `business_event_id`. Estado legítimo só pra dados pré-migração 16.

Ver também: `docs/architecture/nucleo_patrimonial.md`.
