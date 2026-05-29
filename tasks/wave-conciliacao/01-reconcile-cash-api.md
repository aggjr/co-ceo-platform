# CONC-01 — API Conciliação Bancária (extrato ↔ livro)

> **ID:** CONC-01 · **Depende de:** CONC-00  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md) §5.1, §6.1

## 1. Objetivo

Serviço `ReconcileCashService` + rotas REST de preview, insert, delete e pair para extratos BTG vs `financial_ledger_entries`, com **rebuild automático** após mutação.

## 2. Arquivos

- `src/core/invest/reconcile/types.ts` (criar)
- `src/core/invest/reconcile/ReconcileCashService.ts` (criar)
- `src/controllers/InvestController.ts`
- `src/routes/api.ts`
- `tests/unit/invest/reconcile/ReconcileCashService.test.ts` (criar — usar fixtures PDF/TXT em `tests/fixtures/btg/` se existir)

## 3. Contrato preview

```ts
POST /api/invest/reconcile/cash/preview
Body: { files: { name, contentBase64 }[] }
Response: {
  summary: { matched, different, ledgerOnly, fileOnly, skipped },
  ledgerRows: ReconcileCashRow[],
  fileRows: ReconcileCashRow[],
}
```

Reutilizar `previewBtgExtractBatchUpload` + mapear pernas de caixa do livro (mesmo shape que `getExtract` retorna hoje, enriquecido com `rowKey`, `status`).

## 4. Contrato apply

- `apply-insert`: linhas `file_only` / selecionadas → `importEntriesOnly` (extrato)
- `apply-delete`: soft delete pernas financeiras
- Resposta inclui `rebuild: PatrimonyRebuildResult` chamando `PatrimonyDailyRebuildService`

## 5. Critério de aceite

```bash
npx tsc --noEmit
npx jest tests/unit/invest/reconcile/ReconcileCashService.test.ts
```

## 6. O que NÃO fazer

- UI
- Parser novo (usar `BtgExtractLineParser`)
