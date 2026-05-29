# CONC-00 — Rebuild patrimônio diário + gráfico Resultado histórico

> **Onda:** conciliação · **ID:** CONC-00 · **Status:** pronta para execução  
> **Prioridade:** 90 (antes das telas de pasta)  
> **Spec mestre:** [`docs/architecture/invest_conciliacao.md`](../../docs/architecture/invest_conciliacao.md) §5.3, §5.4, §6.3

## 1. Objetivo

Implementar serviço e API que **invalidam e regravam** `invest_portfolio_daily` (e snapshots de ativo) a partir do livro corrigido, e corrigir o **Resultado histórico** para usar patrimônio econômico (`mtm_economic`) em vez de curva calibrada BTG como padrão.

## 2. Contexto

O gráfico em `/invest` está incorreto porque combina livro inconsistente, fechamentos antigos e `method=mtm_btg` com calibração por âncoras. Toda conciliação futura deve disparar rebuild automático; esta task entrega o motor antes das UIs de pasta.

## 3. Arquivos a tocar

- `src/core/invest/PatrimonyDailyRebuildService.ts` (criar)
- `src/controllers/InvestController.ts` (rotas `rebuild`, `rebuild-status`)
- `src/routes/api.ts`
- `frontend/src/pages/InvestDashboardPage.js` (`method=mtm_economic`)
- `tests/unit/invest/PatrimonyDailyRebuildService.test.ts` (criar)

## 4. Contrato

```ts
export type PatrimonyRebuildResult = {
  from: string;
  to: string;
  daysWritten: number;
  daysSkipped: number;
  quotesCoverage: { tickers: number; daysWithQuotes: number };
  warnings: string[];
};

export class PatrimonyDailyRebuildService {
  async rebuild(
    ctx: UserContext,
    opts?: { from?: string; to?: string }
  ): Promise<PatrimonyRebuildResult>;
}
```

Fluxo interno obrigatório:

1. `PatrimonyDailyStore.invalidateFromDate(ctx, from)`
2. Loop dias úteis `[from..to]`: `PatrimonyDailyRecorder.recordDay` gravando `source: 'mtm_economic'` (ajustar recorder se hoje grava só `mtm_btg_calibrated`)
3. `ledger.reconcileCustody(ctx)`

## 5. Critério de aceite

```bash
npx tsc --noEmit
npx jest tests/unit/invest/PatrimonyDailyRebuildService.test.ts
```

Manual: após `POST /api/invest/patrimony-daily/rebuild` com org personificada, `GET /api/invest/patrimony-daily?method=mtm_economic` retorna série com `patrimonySource` sem `ledger_plus_btg_anchors` e `dailyRecording.storedDaysInRange` > 0 no período.

## 6. Pegadinhas

- `recordDay` hoje pode gravar `mtm_btg_calibrated` — rebuild deve forçar `mtm_economic`.
- `invalidateFromDate` já apaga `invest_daily_snapshots` — não duplicar lógica.
- Período mínimo: respeitar `periodMin` de `ui-context`.

## 7. O que NÃO fazer

- Telas de conciliação (CONC-02/04)
- Alterar `threePricesEngine`
- Remover endpoint `method=mtm_btg` (só deixar de ser default na UI)
