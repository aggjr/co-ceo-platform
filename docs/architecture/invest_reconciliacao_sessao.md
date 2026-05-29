# INVEST — Sessão de conciliação, varredura e materialização progressiva

> **Documento arquitetural avançado** — orienta implementação por agentes executores.  
> **Complementa:** [`invest_conciliacao.md`](invest_conciliacao.md)  
> **Ordem obrigatória do produto:** (1) pasta local de **notas** → (2) conciliação **dia a dia** → (3) extrato **depois** → (4) materialização diária contínua.

---

## A. Modelo conceitual

### A.1 Três camadas de verdade

| Camada | O que é | Quando fica “verdadeira” |
|--------|---------|-------------------------|
| **Fonte externa** | PDFs no disco do usuário (notas, depois extratos) | Nunca persistida no repo — só parse em memória na sessão |
| **Livro canônico** | `business_events` + `patrimony_ledger_entries` + `financial_ledger_entries` | A cada ação →/← aprovada pelo usuário |
| **Projeções materializadas** | Custódia, 3 preços, patrimônio diário, gráfico | A cada **fechamento de dia** reconciliado |

O usuário não “importa e reza”. Ele **fecha dias** na ordem cronológica; o sistema só avança o “horizonte confiável” quando o dia está limpo.

**Sistema financeiro:** divergência **não pode** permanecer implícita, ser “corrigida” em background ou ignorada. O backend **detecta**; a UI **exibe** cada caso; o usuário **escolhe** a ação antes de qualquer mutação ou fechamento (§J).

### A.2 Sessão vs fechamento de dia

**Sessão de conciliação** (`ReconciliationSession`):

- Uma org + um tipo (`notes` | `cash`) + índice dos arquivos parseados (hash, metadados).
- Estado: `in_progress` | `notes_complete` | `cash_complete` | `aborted`.
- Persistida em MySQL para retomar trabalho (navegador fechou, agente continua).

**Fechamento de dia** (`DayClosure`):

- Para cada `pregaoDate` (notas) ou `transaction_date` (extrato): **todas** as linhas do preview em `matched` ou `skipped` (informativas).
- Gate **estrito v1** (§J): sem `different`, `ledger_only`, `file_only`, `blocked`; varredura sem `warn`/`error`/`critical`.
- **Sem** `forceClose`, **sem** `acceptWarnings` na API v1 — o usuário corrige até `canClose === true`.
- Efeito colateral obrigatório ao fechar: `materializeThroughDate(D)` (§D).

### A.3 “View” patrimonial as-of (estado consultável)

Não é VIEW SQL única — é **pacote de projeções** recalculado até `asOfDate`:

```
GET /api/invest/reconcile/as-of?date=YYYY-MM-DD
→ {
    horizonTrustedThrough,      // último dia fechado na sessão
    custody: PortfolioRow[],     // patrimony_items + ext
    threePrices: Map<ticker, ThreePrices>,
    patrimonySeries: DailyPoint[],  // invest_portfolio_daily até asOf
    audit: AuditSummary,         // varredura residual
    openIssues: Issue[]          // o que impede fechar próximo dia
  }
```

A UI simples mostra: **barra de progresso por dia** + tabela do dia corrente + painel “estado até ontem” (read-only). Carteira e gráfico em `/invest` passam a refletir `horizonTrustedThrough` sem esperar fim da pasta inteira.

---

## B. Pipeline em fases (notas primeiro)

```
FASE 0 — Pré-voo (uma vez por org, antes da pasta)
  └─ GET `/api/invest/reconcile/preflight` → se há dados além da abertura, UI pergunta:
       **Recuperar** (`dataMode: recover`) ou **Refazer do zero** (`reset_from_opening`)
  └─ Refazer do zero: `POST /api/invest/reconcile/reset-holding` — purge via `HoldingPurgeKeepOpeningService`
       (mantém usuários/IAM, `OPENING:{openingDate}` + pernas `opening_balance` na data de abertura do livro)
  └─ Varredura global do livro atual (§C) → relatório baseline
  └─ Abort se não houver abertura no livro

FASE 1 — NOTAS (obrigatória primeiro)
  1. POST session/start { phase: "notes", files[] }
  2. Parse todos PDFs → índice por pregaoDate + noteNumber
  3. Calendário de dias úteis [firstPregao .. lastPregao]
  4. Para cada dia D em ordem:
       a. previewDay(D) → fileRows vs ledgerRows
       b. para cada pendência: POST day/D/resolve { action } (usuário decide)
       c. POST day/D/close (só se canClose) → materializeThrough(D)
       d. session.progress[D] = "closed"
  5. POST session/complete-notes → phase notes_complete
  6. Varredura pós-notas (§C) — gate antes de Fase 2

FASE 2 — EXTRATO (somente após notes_complete)
  1. POST session/start { phase: "cash", files[] }  // mesma sessionId ou filha
  2. Dias em ordem (transaction_date no extrato)
  3. Mesmo loop preview → resolve → close
  4. cashFromExtractOnly já aplicado nas notas (caixa vem do extrato)

FASE 3 — Rebuild final + gráfico
  1. POST patrimony-daily/rebuild { from: periodMin, to: today }
  2. Dashboard method=mtm_economic
  3. Varredura final — meta: zero issues bloqueantes (§J)
```

**Regra:** Fase 2 **bloqueada** na API até `session.notes_complete` — **sem** `forcePhase2` na v1.

---

## C. Varredura completa do sistema (`ReconciliationAuditService`)

Serviço único, invocado em: início de sessão, após cada `day/close`, fim de fase.

| # | Dimensão | Detecção | Severidade | Auto-fix | Dono |
|---|----------|----------|------------|----------|------|
| 1 | Header sem pernas | `business_events` sem ple/fle ativas | error | não | Audit |
| 2 | Soma pernas ≠ header | `BusinessEventReconciler` | error | não | Audit |
| 3 | Duplicata `external_ref` | GROUP BY ref HAVING count>1 | error | não (UI escolhe) | Audit |
| 4 | Duplicata dedup livro | `buildLedgerDedupIndex` hit | warn | não | Usuário escolhe qual manter |
| 5 | Nota no arquivo sem livro | preview notes `file_only` | warn | não | Usuário: inserir ou ignorar com motivo |
| 6 | Livro sem nota (trade) | `ledger_only` com broker_note_ref | warn | não | Usuário: void ou parear nota |
| 7 | Taxas zeradas na perna | review row feesSource=none | warn | não | Usuário: reimportar linha / void / ajuste |
| 8 | Caixa nota ≠ líquido | \|amount - expectedNet\| > 0.02 | error | não | Usuário: amend / void / parear |
| 9 | Caixa sem broker_note_ref | fee/div sem vínculo | warn | não | Usuário: vincular nota ou void |
| 10 | Extrato vs caixa dia | reconcile-cash daily diff | error | não | Usuário: insert / delete / parear |
| 11 | LIQ BOLSA duplicada | classificação + ledger | info | não | Usuário confirma `skipped` no preview |
| 12 | PM três preços | recompute vs patrimony ext | warn | não | Usuário: rebuild após resolver livro |
| 13 | qty patrimony_items | SUM(ple) vs pi.quantity | error | não | Usuário: reconciliar custódia após livro |
| 14 | Abertura alterada | source_ref ≠ OPENING:2026-01-01 | critical | não | Sessão abortada — sem override |
| 15 | Fechamento diário buraco | dia útil sem row em portfolio_daily após horizon | warn | não | Fechar dia (materialize) após livro limpo |
| 16 | Cotação ausente | market_quotes_daily gap no range | warn | não | Usuário: sync depois ou adiar fechamento |
| 17 | Âncora BTG vs econômico | \|anchor - patrimony\| > threshold | info | não | Somente leitura — não bloqueia |

Coluna **Auto-fix:** sempre **não** na v1. Toda coluna **Dono** = decisão explícita do usuário na UI.

**Saída:** `AuditReport { runAt, issues: AuditIssue[], pendingDecisions[], canProceedToNextDay }`.

Cada `AuditIssue` com `severity !== 'info'` vira `ReconcileDecision` na fila (§J.2). `canProceedToNextDay`: `pendingDecisions.length === 0` (§J.4).

---

## D. Materialização progressiva (decisão arquitetural)

### Opções avaliadas

| Abordagem | Prós | Contras | Veredito |
|-----------|------|---------|----------|
| VIEW SQL `v_custody_as_of` | SQL nativo | Livro mutável; VIEW não invalida bem | **Rejeitada** |
| Redis cache | Rápido | Volátil; multi-tenant chato | **Rejeitada** |
| **Tabelas de projeção existentes + rebuild parcial** | Já existe; auditável | Precisa invalidate cirúrgico | **Escolhida** |

### Algoritmo `materializeThroughDate(ctx, throughDate)`

Executado em **todo** `day/close` e **todo** apply avulso:

```text
1. mutations já commitadas (gateway)
2. ledger.reconcileCustody(ctx)
3. PatrimonyDailyStore.invalidateFromDate(ctx, throughDate)
4. Para d em businessDays(periodMin .. throughDate):
     PatrimonyDailyRecorder.recordDay(ctx, d)
     — source: 'mtm_economic' (nunca mtm_btg_calibrated no rebuild de sessão)
5. session.horizon_trusted_through = throughDate
6. ReconciliationAuditService.run(ctx, { scope: 'through', throughDate })
```

**Partial rebuild** (não regravar 2020→hoje se só mudou março):

- `fromDate = min(mutationDates, throughDate)` capado em `periodMin`.
- Invalida só `>= fromDate`.

**Projeções atualizadas sem tabela nova:**

| Projeção | Mecanismo |
|----------|-----------|
| Custódia / carteira | `patrimony_items` + `invest_position_ext` via `reconcileCustody` |
| 3 preços | `computeThreePricesByUnderlying(events até through)` — on read em `as-of` |
| Patrimônio diário | `invest_portfolio_daily` linhas `mtm_economic` |
| Gráfico | `GET patrimony-daily?method=mtm_economic&to=through` |

### Tabelas novas (mínimo)

```sql
-- invest_reconciliation_sessions
id, organization_id, phase ENUM('notes','cash'),
  status, horizon_trusted_through DATE NULL,
  file_index JSON,        -- metadados parse (não PDF)
  progress_by_day JSON,   -- { "2026-01-02": "closed", ... }
  started_at, updated_at, completed_at

-- invest_reconciliation_day_log (auditoria + decisões do usuário)
session_id, business_date, action ENUM('preview','resolve','close'),
  inserted, deleted, skipped, user_decisions JSON, audit_snapshot JSON
```

Sem duplicar lançamentos: o livro continua fonte única.

---

## E. API (superfície mínima completa)

Todas sob `/api/invest/reconcile/`, permissões `invest:ledger:read|write`.

### Sessão

| Método | Rota | Body | Response |
|--------|------|------|----------|
| POST | `session/start` | `{ phase, files[] }` | `{ sessionId, calendar[], baselineAudit }` |
| GET | `session/:id` | — | `{ status, phase, horizon, progressByDay, audit }` |
| POST | `session/:id/complete-phase` | — | `{ nextPhase?, audit }` |

### Dia (núcleo do produto)

| Método | Rota | Body | Response |
|--------|------|------|----------|
| GET | `session/:id/day/:date` | — | `{ preview, pendingDecisions[], asOfState, canClose, blockReasons[] }` |
| POST | `session/:id/day/:date/resolve` | `{ decisionId, action, ...payload }` | `{ preview, pendingDecisions[], canClose }` |
| POST | `session/:id/day/:date/apply` | `{ insertRowKeys[], deleteLedgerIds[], pairs[] }` | `{ preview, pendingDecisions[], mutations }` |
| POST | `session/:id/day/:date/close` | — (corpo vazio) | `{ closed: true, horizon, audit }` ou `409` + `pendingDecisions` |

### Varredura e consulta

| Método | Rota | Query | Response |
|--------|------|-------|----------|
| POST | `audit/run` | `{ through? }` | `AuditReport` |
| GET | `as-of` | `date` | `AsOfPackage` (§A.3) |

### Patrimônio (existente estendido)

| Método | Rota | Nota |
|--------|------|------|
| POST | `patrimony-daily/rebuild` | Full rebuild; sessão usa materialize parcial |

### Legado útil (interno, não exposto na UI nova)

- `previewBtgBrokerageUpload`, `previewBtgExtractBatchUpload` — chamados **dentro** dos serviços de sessão, não telas separadas.

---

## F. UI simples (wizard mínimo)

Uma tela principal `/invest/conciliacao` (wizard), não duas telas pesadas no início.

**Painel central obrigatório — “Pendências do dia”** (`pendingDecisions`): lista **todas** as divergências (preview + varredura). Cada item mostra contexto (valores livro vs arquivo, refs, delta R$) e **botões de ação explícitos** — nunca avanço automático.

```
[ Passo 1: Pasta de NOTAS (PDF) ]  [ Iniciar sessão ]
[■■■■□□□□□□] Dias: 12/45 fechados   Horizonte confiável: 2026-02-28

◀ 2026-03-01 ▶   [ Fechar dia ]  (desabilitado se pendingDecisions > 0)

┌ PENDÊNCIAS — 3 itens (resolver antes de fechar) ────────────────┐
│ #1 file_only  Nota 45231 — PETR4  +100  → [ Inserir no livro ] │
│ #2 different  Caixa líquido R$ 12,34 vs R$ 12,30 → [ Parear ] │
│ #3 audit      Duplicata external_ref X → [ Manter A ] [ Manter B ]│
└────────────────────────────────────────────────────────────────┘

┌ Livro do dia ──────────┐  → ←  ┌ Notas do dia ──────────┐
│ linhas destacadas      │      │ vinculadas à pendência │
└────────────────────────┘      └────────────────────────┘

[ Patrimônio até 2026-03-01 — R$ ... ]  (somente leitura)

--- Após 100% dias notas ---
[ Passo 2: Pasta de EXTRATOS — desbloqueado ]
```

- Clicar numa pendência **rola/destaca** as linhas nas tabelas laterais.
- `Fechar dia` só habilita quando `canClose === true` (API).
- Mensagem quando bloqueado: `blockReasons[]` do catálogo UI (ex.: “Ainda há 2 divergências sem decisão”).
- **Proibido na UI v1:** checkbox “aceitar aviso”, “ignorar tudo”, import silencioso.

Links: “Ver carteira (até horizonte)”, “Ver Resultado histórico”.

Textos via `ui_text_catalog` — sem strings fixas no JS.

---

## G. Quebra de tasks para agentes (ordem)

| ID | Título | Depende | Entrega |
|----|--------|---------|---------|
| **CONC-00** | Rebuild + dashboard `mtm_economic` | — | PatrimonyDailyRebuildService |
| **CONC-10** | Migração + `ReconciliationSession` store | — | SQL + DAL registry |
| **CONC-11** | `ReconciliationAuditService` (varredura §C) | — | Testes unitários |
| **CONC-12** | `ReconciliationSessionService` + APIs sessão/dia | 10, 11, 00 | Core + routes |
| **CONC-13** | UI wizard conciliação (notas, dia a dia) | 12 | Uma página |
| **CONC-14** | Fase extrato na mesma sessão | 12, 13 notes_complete | Cash loop |
| **CONC-15** | Catálogo UI + menu + deploy | 13, 14 | seeds |

**Paralelo possível:** CONC-00 + CONC-10 + CONC-11.  
**Sequência crítica:** 12 → 13 (notas) → 14 (extrato).

Specs em `tasks/wave-conciliacao/10-*.md` … (criar ao claim).

---

## H. Riscos e invariantes

| Risco | Mitigação |
|-------|-----------|
| Fechar dia com divergência não decidida | `canClose` false + `pendingDecisions` + 409 no close |
| Mutação sem decisão registrada | só via `resolve`/`apply` com log em `user_decisions` |
| Performance (45 dias × rebuild) | Rebuild **parcial** from min mutation date |
| Sessão gigante (500 PDFs) | Parse incremental; `file_index` sem base64 no DB |
| Dois agentes na mesma sessão | `session.organization_id` + lock otimista `updated_at` |
| Caixa duplicado nota+extrato | Fase 1 com `suppressBrokerageNoteCashLines` |

**Invariantes co-CEO:**

- Sem `data/invest/**` no repo.
- Sem FIFO; 3 preços = lote inteiro (`threePricesEngine.ts`).
- Gateway DAL; `voidEvent` para exclusões.
- Abertura `OPENING:2026-01-01` intocável (purge scripts abortam).
- Quantidade livro = qty real (sem ×100).

---

## I. O que o executor NÃO deve fazer

- Implementar Fase 2 (extrato) antes da Fase 1 (notas) estar funcional.
- Importação em lote sem `day/close`.
- Gravar PDF no servidor permanentemente.
- Usar `mtm_btg` como default no gráfico durante sessão de correção.
- Criar segundo livro paralelo (arquivo JSON de posição).
- **Auto-corrigir** divergência (inferir vínculo, inserir duplicata, “melhor palpite”).
- **`acceptWarnings` / `forceClose` / `forcePhase2`** na API v1.
- Fechar dia com `pendingDecisions.length > 0`.

---

## J. Fechamento estrito e decisão humana (v1)

### J.1 Regra de ouro

| Papel | Responsabilidade |
|-------|------------------|
| **Sistema** | Detectar, classificar, exibir, bloquear fechamento |
| **Usuário** | Escolher **uma** ação por divergência; confirmar mutação |

No livro canônico **não existe** estado “quase certo”. Ou está reconciliado (`matched` / `skipped` confirmado) ou está **pendente** na fila.

### J.2 Objeto `ReconcileDecision`

```ts
type ReconcileDecision = {
  decisionId: string;           // estável na sessão+dia
  source: 'preview' | 'audit';
  kind: string;                 // ex. file_only, different, duplicate_external_ref
  severity: 'info' | 'warn' | 'error' | 'critical';
  summaryKey: string;           // chave ui_text_catalog
  context: Record<string, unknown>; // valores, refs, deltas — para a tela
  rowKeys?: string[];           // vínculo com tabelas livro|arquivo
  allowedActions: ReconcileAction[]; // ex. insert_ledger, void_event, pair, keep_a, keep_b, mark_skipped
  resolvedAt?: string;
  resolvedAction?: ReconcileAction;
};
```

Geração:

1. **Preview do dia:** toda linha com `status !== 'matched'` e `status !== 'skipped'` → decisão.
2. **Varredura:** todo `AuditIssue` com `severity` ∈ `{ warn, error, critical }` → decisão (deduplicar se já coberto pelo preview).

### J.3 Catálogo de ações (usuário → API)

| Ação | Efeito no livro | Quando oferecer |
|------|-----------------|-----------------|
| `insert_from_file` | `importEntriesOnly` para `rowKey` | `file_only` |
| `void_ledger` | `voidEvent` | `ledger_only`, duplicata a descartar |
| `pair_rows` | metadata + pareamento | `different`, extrato vs caixa |
| `keep_ledger_row` | marca duplicata resolvida sem void da outra | duplicata `external_ref` |
| `confirm_skipped` | sem mutação; registra decisão | LIQ BOLSA / linha informativa |
| `defer` | **não** remove da fila — só navegação | nunca conta como resolvido |

`POST .../resolve` valida que `action ∈ allowedActions`, grava em `invest_reconciliation_day_log.user_decisions`, executa mutação se houver, recalcula preview + audit.

### J.4 `canClose` (backend — única fonte da verdade)

```text
canClose =
  pendingDecisions.every(d => d.resolvedAt)
  AND preview.rows.every(r => r.status === 'matched' || (r.status === 'skipped' && r.skipConfirmed))
  AND audit.pendingDecisions.length === 0
```

Resposta `409` em `day/close` com `{ pendingDecisions, blockReasons }` — UI não inventa regra local.

### J.5 Rastreabilidade

Cada decisão resolvida fica em `user_decisions` (JSON no `day_log`): `{ decisionId, action, at, userId, rowKeys }` — auditoria financeira.

### J.6 Evolução futura (fora v1)

Override com confirmação dupla (`forceClose`) só se o arquiteto abrir task explícita — **não** implementar agora.

---

*Documento para agentes: leia este arquivo + `invest_conciliacao.md` antes de `task:claim` em CONC-10+.*
