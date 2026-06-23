# Spec — Caixa duplicado nota ↔ extrato + gate de batimento contra o persistido

Status: pronta para execução (executor + validador independente).
Arquiteto definiu (2026-06-23): **extrato é a verdade do caixa**; liquidação por
perfil de ativo (D+1/D+2/D+N) — já dirigida por catálogo, não refazer.

## 1. Bug confirmado (evidência real, servidor `co_ceo_platform`)

Carga 2026 da holding `org-holding-001`. Após importar Jan/2026:

- Extrato BTG fecha 31/01 em **R$ 3.614,36**.
- `settledCashBalanceFromLedger(persistido, '2026-01-31')` = **−R$ 51.530,91**.
- Diferença ≈ **R$ 55.145** = caixa contado em dobro.

Pernas de caixa persistidas em janeiro mostram pares idênticos (mesma data/valor),
um vindo da NOTA e outro do EXTRATO:

| Data | Perna da NOTA (`B3-NOTA-*`) | Perna do EXTRATO (`BTG-EXT-*`) |
|---|---|---|
| 06/01 | `B3-NOTA-27421483` +399,48 | `BTG-EXT-2026-01-06` +399,48 |
| 07/01 | `B3-NOTA-27483500` +1.797,60 | `BTG-EXT-2026-01-07` +1.797,60 |
| 30/01 | `B3-NOTA-28505096` +1.597,86 | `BTG-EXT-2026-01-30` +1.597,86 |

Somando só as pernas `BTG-EXT-*` + abertura → ~R$ 3.619 (≈ fechamento correto).
As pernas `B3-NOTA-*` (via `pending_settlement`/`capital_deposit`) entram POR CIMA.

Script de evidência (descartável, já no repo): `scripts/_diag-jan-cash.ts`.

## 2-BIS. CAUSA-RAIZ REAL (validada contra o servidor em V0.0.434 — corrige a §2)

A tentativa V0.0.434 NÃO resolveu (servidor segue Δ R$ 55.145,27 em jan). A reprodução
exata de `settledCashBalanceFromLedger` mostra **DOIS** double-counts, não um:

`base` (cashBalanceFromLedger, exclui só AUTO-D2) =
abertura 58.758,79 **+ pending_settlement da NOTA +233.018,20** **+ capital_deposit do
EXTRATO +233.022,28** + yield 7,57 + buy −288.170,55 + custos −2,49 + lending 5,84 =
**236.639,64**. `clearedPending` (AUTO-D2 das compras de Tesouro) = **−288.170,55**.
settled = 236.639,64 − 288.170,55 = **−51.530,91** (extrato fecha em 3.614,36).

1. **Entrada dobrada:** o prêmio/exercício de opção entra como `pending_settlement`
   (nota, ref `B3-NOTA-*`, liq=N) **e** como `capital_deposit` (extrato LIQ BOLSA, liq=S,
   ref `BTG-EXT-*#B3-NOTA-*`). `cashBalanceFromLedger` soma AMBOS (só filtra AUTO-D2).
   ~+233k contados duas vezes. O matcher "casa" (liga refs) mas **não neutraliza** a
   perna pending da nota no caixa.
2. **Saída dobrada:** a compra de Tesouro entra como `buy` (−X) no `base` **e** de novo
   via `clearedPending` (perna aberta AUTO-D2 que baixou). ~−288k contados duas vezes.

Net dos dois: +233.022 − 288.170 ≈ −55.148 ≈ Δ observado.

Excluir TODO `pending_settlement` do saldo liquidado e largar `clearedPending` daria
base = 3.621,44 vs extrato 3.614,36 → resíduo R$ 7,08 (provável classificação de
rendimento/lending) — investigar como divergência, NUNCA plug.

DECISÃO DE MODELAGEM NECESSÁRIA (arquiteto): saldo liquidado deve contar o caixa por
**evento** uma única vez, preferindo a perna realizada do EXTRATO; pending da nota +
AUTO-D2 são só representação de trânsito e não entram no liquidado quando o extrato já
confirmou. Dedup por `business_event_id`/link nota↔extrato. Atenção: testes atuais de
`cashInTransit`/`cashInvestLedger` assumem que `clearedPending` ENTRA no liquidado para
fluxos sem perna de extrato — o fix não pode simplesmente removê-lo; tem de deduplicar
por evento.

A parte de V0.0.434 que PRESTA e fica: o gate `evaluatePersistedCashGate` (bloqueia o
mês corretamente). A extensão do matcher para `capital_deposit/cash_yield` foi alavanca
errada (inerte/again-risco) e deve ser revista no fix real.

## 2. Causa-raiz (HIPÓTESE ANTIGA — superada pela §2-BIS)

Caminho do import mensal (`applyBtgMonthImport`, `src/core/invest/btgMonthImportService.ts`):

1. `applyBtgBrokerageUpload` — nota cria posição + perna financeira `pending` que
   liquida via `syncAutoPendingSettlements` (data por `SettlementRulesService`,
   ref `AUTO-D2:<id>` + `:CLEAR`). Isso já vira caixa liquidado na data prevista.
2. `applyBtgExtractUpload({ skipUnmatchedLiqBolsa: false })` — roda
   `settleLiqBolsaEntries` (`src/core/invest/btgUploadImportService.ts:375`). Linha
   de extrato reconhecida como LIQ BOLSA e **casada** é DROPADA (não cria caixa).

O furo: linhas de caixa do extrato que correspondem a uma liquidação de nota **mas
não passam pelo filtro `isLiqBolsaLine`** (rótulo diferente de "LIQUIDACAO BOLSA",
ou crédito genérico classificado como `capital_deposit`/`cash_yield`) **não são
deduplicadas** e persistem ao lado do caixa que a nota já gerou.

O executor deve provar, com `scripts/_diag-jan-cash.ts` estendido, exatamente
quais linhas duplicam e por que escapam do matcher (campo `notes`/classificação).

## 3. Princípio da correção (extrato = verdade do caixa)

- Quando uma linha de extrato representa a **chegada no banco** de uma liquidação
  que a NOTA já registrou (mesmo trade), o caixa do mês deve ser contado **uma vez**.
- Decisão do arquiteto: o **extrato manda**. A perna da nota fica como
  posição/custódia + pendência (`pending`); a confirmação pelo extrato **liquida**
  a pendência existente **sem criar nova perna de caixa**.
- O matcher LIQ BOLSA já faz isso para linhas LIQ BOLSA. A correção é **estender o
  casamento** para cobrir os créditos/débitos do extrato que hoje escapam
  (por rótulo/classificação) mas correspondem a uma liquidação de nota — casando por
  (data de liquidação, valor assinado, e quando houver, data de pregão).
- **Proibido** plug/tolerância para esconder a diferença (regra do projeto).
  Resíduo real que não casa vira `cash_balance_gap`/`extract_divergence` visível.

Não mexer no timing de liquidação: `SettlementRulesService` +
`settlement_rule_candidates` + fallback `investmentSettlementRuleFor` já resolvem
D+1/D+2/D+N por ativo. Só **verificar** que o catálogo cobre os tipos da carteira
(ação D+2, opção D+1, LFT/Tesouro conforme regra) e, se faltar regra, semear no
catálogo (migration/seed), nunca hardcode novo.

## 4. Gate de batimento contra o PERSISTIDO (não contra projeção)

Hoje `applyMonth` (`scripts/reimport-btg-months-2026.ts`) e
`previewBtgMonthImport` reconciliam contra `buildMonthReconcileLedger` — um livro
**projetado a partir da série do extrato**, que bate por construção e MASCARA o
estado real gravado.

Correção: o critério que decide "mês OK" deve, **após gravar**, comparar
`settledCashBalanceFromLedger(persistidoApósImport, fechamentoDoExtrato)` com o
fechamento do extrato. `applyBtgMonthImport` já relê `eventsAfter` e monta
`freshReconcile` (`btgMonthImportService.ts:1070+`) — usar ESSE resultado como
gate de bloqueio do mês (hoje ele só alimenta `cash_balance_gap`).

## 5. Critério de aceite (contrato objetivo — sem isto verde, não está pronto)

1. **Invariante de caixa por mês (o principal):** após importar cada mês de
   2026 (jan→jun) na holding, para cada fim de mês:
   `|settledCashBalanceFromLedger(persistido, fimMes) − fechamentoExtratoMes| ≤ R$ 0,01`.
   Medido sobre o livro REAL (relido do gateway), não sobre projeção.
2. **Sem regressão:** `node ./node_modules/typescript/bin/tsc --noEmit` limpo e a
   suíte Jest 100% verde (hoje 136 suites / 641 testes).
3. **Teste de unidade novo (red→green):** fixture com 1 nota que liquida (D+N) +
   linha de extrato correspondente NÃO rotulada LIQ BOLSA. Provar que ANTES do fix
   o caixa duplica e DEPOIS bate. Cobrir os 3 caminhos: casado (1 perna), não
   casado→`cash_balance_gap`/`extract_divergence`, e divergência real preservada.
4. **Gate real:** teste provando que um mês cujo caixa persistido diverge do
   extrato é BLOQUEADO (não "OK") pelo critério novo; reverter o fix e provar que
   passava (gate auto-realizável).

## 6. Validação independente (anti-marra)

Validador (sessão/agente diferente do executor):
- Reproduz do zero o invariante §5.1 contra o servidor (ou InMemoryGateway com a
  carga real) e confirma red→green dos testes §5.3/§5.4.
- Recusa qualquer tolerância alargada, plug, ou casamento "por descarte" que
  invente tipo plausível em vez de `extract_divergence`.

## 7. Arquivos no escopo

- `src/core/invest/btgUploadImportService.ts` (`settleLiqBolsaEntries`, classificação de crédito/débito do extrato)
- `src/core/invest/btgMonthImportService.ts` (gate `applyBtgMonthImport`/`previewBtgMonthImport` contra persistido)
- `src/core/invest/cashInvestLedger.ts` (`settledCashBalanceFromLedger` — só se a contagem de `pending_settlement`/`capital_deposit` estiver errada)
- `src/core/invest/LedgerImportService.ts` (`settleLiqBolsa` — janela de casamento)
- `settlement_rule_candidates` seed/migration — só se faltar regra por ativo
- `scripts/reimport-btg-months-2026.ts` — usar o gate persistido; limpar `lastDayOfMonth` órfão deixado na sessão anterior
- Testes: `tests/unit/invest/btgUploadImportService.test.ts`, `btgMonthImportService.test.ts`, `cashInvestLedger.test.ts`

## 8. Fora do escopo

- Marcação a mercado (MTM) / cotações — outra frente.
- Refator de `MAIN_CASH_TICKER` por org (B-02) — só se bloquear; não é desta task.
- Não renomear `AUTO-D2:` (rótulo); o timing já é por catálogo.
