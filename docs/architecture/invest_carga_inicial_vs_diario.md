# INVEST — Carga inicial vs. fechamento diário do patrimônio

Documento canônico sobre **quando o sistema pode estimar** o patrimônio e quando
ele deve usar **apenas dado real de mercado**. Leia antes de mexer em qualquer
rotina que grave `invest_portfolio_daily` / `invest_position_daily`.

## Princípio

A estimativa por âncoras mensais do home broker é uma **ponte de carga inicial**.
Ela existe porque, no primeiro import de um cliente, não há como comprar o
histórico de fechamento de opções passadas sem uma API paga. Depois da carga
inicial, o sistema **não estima**: usa cotação real das fontes mapeadas em banco
(em ordem de prioridade) e, na falta de cotação de opção, recorre a modelo
(Black-Scholes / decaimento), nunca ao "plug" de âncora.

## Os dois modos

| Aspecto | Carga inicial (`initialLoad: true`) | Fechamento diário / recorrente (padrão) |
|---|---|---|
| Quando | 1ª carga de dados do cliente; backfill histórico | Job diário (~noite) e qualquer recálculo |
| Cotação de ação/FII | `market_quotes_daily` (web) | `market_quotes_daily` (web) |
| Cotação de opção | web se existir; senão **estimativa por âncora** | web se existir; senão Black-Scholes/decaimento |
| Calibração à âncora BTG | Sim (resíduo distribuído nas opções) | **Não** |
| Resultado | Histórico reconstruído, fecha com âncoras mensais | Patrimônio econômico real do dia |

## Cadeia de prioridade da valoração (ambos os modos)

Para cada posição, o motor (`PatrimonyMtmDailyEngine`) resolve a marca nesta ordem:

1. **Cotação real do dia** (`market_quotes_daily`, alimentada pelas fontes
   mapeadas — brapi para ações/FII, opcoes.net para opções).
2. **Último mercado conhecido** (carrega o último fechamento real disponível).
3. **Black-Scholes** (apenas opções, quando há spot do ativo-objeto).
4. **Custo do livro** (último recurso para ativos à vista).

Somente no **modo carga inicial**, após essa cadeia, entra o passo extra:

5. **Estimativa por âncora** — o resíduo (`alvo da âncora − base − pendências −
   opções já marcadas a mercado`) é distribuído nas opções estimadas, fazendo a
   série fechar com as âncoras mensais do home broker.

## Onde cada modo é acionado (código)

- `PatrimonyDailyRecorder.recordDay(ctx, date, { initialLoad })` — porta única.
  `initialLoad` ausente/`false` ⇒ econômico. `true` ⇒ permite estimativa por âncora.
- **Fechamento diário recorrente** (`investDailyCloseService.runInvestDailyCloseForOrg`,
  acionado pelo cron `runPatrimonyDailyCloseJob`): chama `recordDay` sem `initialLoad`
  ⇒ econômico. **Nunca estima por âncora.**
- **Carga inicial / backfill histórico**: passam `initialLoad: true`
  (`scripts/build-patrimony-daily-2026.ts`, `backfill-daily-patrimony.ts`,
  `sync-necton-patrimony.ts`, `apply-broker-holding-snapshot.ts`,
  `apply-broker-options-pending-ledger.ts`).
- `PatrimonyDailyRebuildService.rebuild(ctx, { initialLoad })` e
  `DailyCloseMaterializeService.materializeDay(ctx, date, { initialLoad })`
  propagam o flag; padrão `false` (econômico).

## Âncoras: fonte de dados

As âncoras mensais vivem em `invest_patrimony_monthly_anchors` (por organização),
populadas via `PatrimonyMonthlyAnchorsSeedService`. **Não há fallback hardcoded**
no caminho de carga inicial: sem âncoras no banco, a reconstrução aborta com erro
explícito. Os fechamentos mensais do home broker (ex.: `patrimonio_inicial`,
`patrimonio_final`, `rendimentos`, `aportes_retiradas`, `impostos`) alimentam o
seed.

## Job diário (parametrização)

O cron embutido (`startInvestMarketCron`) roda três etapas, com horários
parametrizáveis por env (fuso `INVEST_CRON_TZ`, padrão `America/Sao_Paulo`):

| Etapa | Env | Padrão |
|---|---|---|
| Opções (opcoes.net) | `INVEST_CRON_OPTIONS_AT` | `20:05` |
| Ações (brapi) | `INVEST_CRON_STOCKS_AT` | `20:20` |
| Fechamento patrimônio | `INVEST_CRON_PATRIMONY_AT` | `21:00` |

Para rodar por volta das 19h, ajuste os envs (ex.: `19:00`, `19:10`, `19:20`).

## Regras invioláveis

1. Estimativa por âncora **só** em carga inicial (`initialLoad: true`).
2. Job diário e recálculos recorrentes **sempre** econômicos (dado real).
3. Web primeiro; estimativa só quando não há cotação real disponível.
4. Sem âncora/ticker/data hardcoded no caminho de carga — tudo do banco.
