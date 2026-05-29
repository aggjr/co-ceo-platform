# CONC-03 — API Conciliação de Ativos (notas ↔ livro)

> **ID:** CONC-03 · **Depende de:** CONC-00  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md) §5.2, §6.2

## 1. Objetivo

`ReconcileAssetsService` — preview/apply de notas PDF vs livro patrimonial + vínculo caixa + PM (3 preços).

## 2. Arquivos

- `src/core/invest/reconcile/ReconcileAssetsService.ts` (criar)
- `src/controllers/InvestController.ts`
- `src/routes/api.ts`
- `tests/unit/invest/reconcile/ReconcileAssetsService.test.ts`

## 3. Contrato

Reutilizar `previewBtgBrokerageUpload`, `buildBrokerageNoteReviewRows`, `computeThreePricesByUnderlying`.

`apply-insert` com opção `cashFromExtractOnly: true` quando política da org exige extrato como fonte de caixa.

Cada apply dispara `PatrimonyDailyRebuildService.rebuild`.

## 4. Critério de aceite

```bash
npx tsc --noEmit
npx jest tests/unit/invest/reconcile/ReconcileAssetsService.test.ts
```

## 5. O que NÃO fazer

- UI
- Substituir `HistoricoOperacoesPage` nesta task (pode permanecer até CONC-04)
