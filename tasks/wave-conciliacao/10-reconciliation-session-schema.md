# CONC-10 — Schema e store da sessão de conciliação

> **Spec mestre:** [`docs/architecture/invest_reconciliacao_sessao.md`](../../docs/architecture/invest_reconciliacao_sessao.md) §D, §E

## Objetivo

Migração SQL + tipos + leitura/escrita via `CoCeoDataGateway` para `invest_reconciliation_sessions` e opcional `invest_reconciliation_day_log`.

## Arquivos

- `src/database/migrations/34_invest_reconciliation_sessions.sql` (criar)
- `src/core/dal/TableRegistry.ts` (registrar tabelas tenant)
- `src/core/invest/reconcile/ReconciliationSessionStore.ts` (criar)

## Critério de aceite

```bash
npx tsc --noEmit
```

Migração aplica sem erro; store persiste `progress_by_day`, `horizon_trusted_through`, `day_log.user_decisions` (JSON auditoria §J.5).
