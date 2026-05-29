# CONC-14 — Fase extrato na sessão (após notas)

> **Spec mestre:** [`docs/architecture/invest_reconciliacao_sessao.md`](../../docs/architecture/invest_reconciliacao_sessao.md) §B Fase 2  
> **Depende:** CONC-13 (notes_complete)

## Objetivo

Estender `ReconciliationSessionService` para `phase: cash` — bloqueado até notas completas. Mesmo loop: `pendingDecisions` + `resolve` + `close` estrito com `previewBtgExtractBatchUpload`.

## Critério de aceite

API retorna 403 em `session/start` cash se notas incompletas; fluxo manual extrato após 100% dias notas.
