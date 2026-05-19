# Handoff para validação externa — INVEST / custódia

Repositório alvo: https://github.com/aggjr/co-ceo-platform

## Escopo desta entrega (sessão Cursor)

Funcionalidades e correções implementadas no código (podem não estar aplicadas no MySQL até rodar import/correções):

| Área | Arquivos principais |
|------|---------------------|
| Cobertura CALL (ações) | `src/core/invest/callCoverage.ts`, `frontend/src/lib/portfolioDisplay.js` |
| Strikes Profit (notional) | `src/core/invest/optionStrikeCatalog.ts`, `src/core/invest/optionStrike.ts` |
| Extrato BTG 18–19/05 | `src/core/invest/btgExtractMay182026.ts` |
| Vendas PRIOF 18/05 | `src/core/invest/priofCallSellsMay182026.ts` |
| Remoção CDB + correções | `src/core/invest/custodyCorrections.ts`, `src/core/invest/CustodyCorrectionService.ts` |
| Saldo caixa (extrato) | `src/core/invest/cashInvestLedger.ts`, `src/core/invest/CustodyEngine.ts` |
| API | `POST /api/invest/custody/apply-corrections`, `src/controllers/InvestController.ts` |
| Dados import | `frontend/public/data/invest/btg-augusto-h1-2026.json` |
| Testes | `tests/unit/invest/*.test.ts` |

## Critérios de aceite (dados reais)

1. **Sem** `CDB-BTG-20240802` na custódia.
2. **TESOURO-SELIC-2031**: ~**11** títulos (após vendas extrato 18/05), não 58.
3. **CAIXA-BTG**: saldo **R$ 2.760,96** (extrato 19/05), não ~R$ 58 mil.
4. **PRIO3** — CALLs vendidas: **2.400** (PRIOF740/750/760/780); prêmio D+1 **R$ 3.094**; CALLs sobrando **10.300**.
5. Opções: coluna **Tipo** CALL/PUT; strikes → notional preenchido.

## Comandos após clone

```bash
npm install
npm test -- tests/unit/invest
```

Aplicar correções na base (API rodando, org personificada):

```http
POST /api/invest/custody/apply-corrections
```

Ou:

```bash
npx ts-node scripts/invest-apply-corrections.ts
```

## Limitação arquitetural conhecida

`listPortfolio` mistura snapshot `invest_assets` com `rebuildCustodyFromLedger`. Correções no JSON **não** alteram o banco automaticamente. Validador deve conferir **livro-razão** e não só UI.

## Valores extrato (referência)

**18/05 LFT (créditos):** +284.035,80 e +56.807,16  
**18/05 taxas/IRRF:** -711,34 -46,93 -38,44 -595,59 -4.982,73 -358,11  
**19/05:** LIQ BOLSA pregão 15/05 **-453.223,65** → saldo **2.760,96**

**PRIOF prêmios:** 440 + 1116 + 1022 + 516 = **3.094**
