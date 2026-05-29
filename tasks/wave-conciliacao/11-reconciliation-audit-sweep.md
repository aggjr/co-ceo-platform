# CONC-11 — Varredura completa (ReconciliationAuditService)

> **Spec mestre:** [`docs/architecture/invest_reconciliacao_sessao.md`](../../docs/architecture/invest_reconciliacao_sessao.md) §C

## Objetivo

Implementar `ReconciliationAuditService.run(ctx, opts)` com as 17 dimensões da tabela §C.

Retorno: `AuditReport` com `issues[]` e `pendingDecisions[]` (mapear cada issue `warn|error|critical` → `ReconcileDecision` com `allowedActions` — **sem auto-fix**).

`canProceedToNextDay` = `pendingDecisions.length === 0` (§J.4).

Reutilizar `BusinessEventReconciler`, `buildLedgerDedupIndex`, `computeThreePricesByUnderlying`, lógica de `getExtract` para vínculo caixa-nota.

## Arquivos

- `src/core/invest/reconcile/ReconciliationAuditService.ts`
- `src/core/invest/reconcile/auditTypes.ts` (`ReconcileDecision`, `ReconcileAction` — compartilhado com CONC-12)
- `tests/unit/invest/reconcile/ReconciliationAuditService.test.ts`

## Critério de aceite

```bash
npx jest tests/unit/invest/reconcile/ReconciliationAuditService.test.ts
npx tsc --noEmit
```
