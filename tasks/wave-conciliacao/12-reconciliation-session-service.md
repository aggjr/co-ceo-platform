# CONC-12 — Sessão de conciliação + API dia a dia + materialize

> **Spec mestre:** [`docs/architecture/invest_reconciliacao_sessao.md`](../../docs/architecture/invest_reconciliacao_sessao.md) §B, §D, §E, **§J**  
> **Depende:** CONC-00, CONC-10, CONC-11

## Objetivo

`ReconciliationSessionService`: start (notes files), preview por dia com `pendingDecisions[]`, `POST .../resolve` (decisão humana → mutação), `apply`/`close`, `materializeThroughDate`, gate fase 2, `GET as-of`.

- `canClose` só true quando todas as decisões resolvidas (§J.4).
- `day/close` sem body; `409` se ainda houver pendências.
- Persistir `user_decisions` no `day_log`.
- **Proibido:** `acceptWarnings`, `forceClose`, auto-fix.

Integrar parsers existentes (`previewBtgBrokerageUpload`, `brokerageNotesToLedgerLines`, `importEntriesOnly`, `voidEvent`).

## Arquivos

- `src/core/invest/reconcile/ReconciliationSessionService.ts`
- `src/controllers/InvestController.ts` (métodos reconcile)
- `src/routes/api.ts`

## Critério de aceite

```bash
npx tsc --noEmit
npx jest tests/unit/invest/reconcile/ReconciliationSessionService.test.ts
```

Teste integração: dia com `file_only` → `close` retorna 409 → `resolve` insert → `close` ok → `horizon_trusted_through` = dia 1.
Teste: `close` com `pendingDecisions` > 0 sempre 409.
