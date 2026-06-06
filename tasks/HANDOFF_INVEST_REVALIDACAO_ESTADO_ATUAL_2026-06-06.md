# Handoff INVEST - Revalidacao do estado atual

Data: 2026-06-06
Branch: `codex-guto`
Status: etapa de revalidacao atual concluida, com alteracoes locais ainda nao commitadas.

## Objetivo desta etapa

Fechar a revalidacao do estado atual do modulo INVEST depois do plano definitivo de arquitetura, sem continuar novas frentes. O foco foi reduzir risco nos pontos que impactam diretamente conciliacao, caixa em transito, patrimonio diario e regras de liquidacao.

## Alteracoes locais realizadas

### 1. Caixa em transito nao some mais por vencimento automatico

Arquivos:

- `src/core/invest/cashInvestLedger.ts`
- `src/core/invest/cashInTransit.ts`
- `src/core/invest/reconcile/ReconciliationDiagnosticsService.ts`
- `tests/unit/invest/cashInTransit.test.ts`
- `tests/unit/invest/reconcile/ReconciliationDiagnosticsService.dailyAudit.test.ts`

Comportamento anterior:

- Uma pendencia `pending_settlement` podia deixar de aparecer apenas porque `settleDate <= asOfDate`, mesmo sem existir a perna `:CLEAR`.
- Isso explicava o bug reportado: o saldo saia do transito, mas nao entrava corretamente no caixa liquidado, fazendo o movimento financeiro desaparecer.

Comportamento novo:

- Pendencia aberta continua em transito ate existir baixa explicita `AUTO-D2:<tradeId>:CLEAR`.
- No auditor diario, a abertura do dia continua mostrando transito aberto; a baixa acontece durante o dia em que a perna `:CLEAR` aparece.
- Teste novo cobre pendencia vencida sem baixa.

### 2. AutoPendingSettlementSync usa regras configuradas

Arquivos:

- `src/core/invest/AutoPendingSettlementSync.ts`
- `tests/unit/invest/AutoPendingSettlementSync.test.ts`

Comportamento anterior:

- A decisao de gerar D+n automatico vinha de `settlementCalendar.ts` com regra hardcoded.

Comportamento novo:

- O fluxo usa `SettlementRulesService`.
- Resolve regra por `tradeDate`, `assetType`, `transactionType` e `ticker`.
- Se nao houver regra configurada ou offset positivo, nao cria pendencia automatica.

### 3. Importacao enriquece settlement_date pelo banco

Arquivos:

- `src/core/invest/LedgerImportService.ts`
- `tests/unit/invest/LedgerImportService.errors.test.ts`

Comportamento anterior:

- Parsers/tradutores podiam trazer `settlement_date` calculado por helper legado.
- O `InvestOperations.recordOperation` ja consultava regra para saber se diferia caixa, mas usava `line.settlement_date` como data final.

Comportamento novo:

- `LedgerImportService.importPortfolio` e `importEntriesOnly` chamam `SettlementRulesService` antes de gravar.
- Quando ha regra configurada, `settlement_date` e `settlement_status` passam a vir da regra.
- Quando nao ha regra, preserva o payload original.
- Teste novo confirma que uma compra PRIO3 em 2026-05-12 sobrescreve `settlement_date` para 2026-05-14 pelo fixture de regra D+2.

### 4. Patrimonio historico deixa de usar RF como excecao de ancora

Arquivos:

- `src/core/invest/PatrimonyDailyRecorder.ts`
- `src/core/invest/PatrimonyMtmDailyEngine.ts`
- `src/controllers/InvestController.ts`

Comportamento ajustado:

- Renda fixa passa a priorizar valor do livro/cotacao como ativo normal.
- `fixed_income_total` de ancora fica como referencia/auditoria, nao como substituto primario para o valor da posicao.
- `InvestController` agora passa `AssetValuationContext` e FX para o MTM historico.

Observacao:

- Ainda existe fallback legado `fixedIncomeTotal` em `PatrimonyMtmDailyEngine` para bases sem posicao detalhada. Isso foi documentado no comentario como fallback, mas o objetivo final deve ser eliminar quando toda RF antiga estiver modelada como ativo com quantidade e PU.

### 5. Metadata e controller reduzem hardcodes stock/FII

Arquivos:

- `src/core/invest/PatrimonyDailyEngine.ts`
- `src/core/invest/PatrimonyMtmDailyEngine.ts`
- `src/controllers/InvestController.ts`

Comportamento ajustado:

- Metadata deixou de expor `stock_cash_settlement_days: 2` como verdade arquitetural.
- Textos passaram a referenciar regras contratuais configuradas.
- O controller de carteira usa `AssetValuationContext`/`categoryFor` para reconhecer categorias `B3_EQUITY_SPOT`, em vez de depender apenas de `stock`/`fii` nos pontos de cotacao e tres precos.

## Validacoes executadas

Build:

```powershell
npm run build
```

Resultado: passou.

Testes focados:

```powershell
node .\node_modules\jest\bin\jest.js --selectProjects unit-core --testPathPattern="(LedgerImportService.errors|AutoPendingSettlementSync|cashInTransit|cashInvestLedger|ReconciliationDiagnosticsService|PatrimonyMtmDailyEngine|PatrimonyMtmEconomic|patrimonyLedgerGates|storedPatrimonyChart|btgHomeBrokerImport|btgBrokerageNoteLedgerTranslator)" --runInBand
```

Resultado final: passou.

Resumo final:

- 11 test suites passed
- 36 tests passed

## Arquivos modificados nesta etapa

```text
src/controllers/InvestController.ts
src/core/invest/AutoPendingSettlementSync.ts
src/core/invest/LedgerImportService.ts
src/core/invest/PatrimonyDailyEngine.ts
src/core/invest/PatrimonyDailyRecorder.ts
src/core/invest/PatrimonyMtmDailyEngine.ts
src/core/invest/cashInTransit.ts
src/core/invest/cashInvestLedger.ts
src/core/invest/reconcile/ReconciliationDiagnosticsService.ts
tests/unit/invest/AutoPendingSettlementSync.test.ts
tests/unit/invest/LedgerImportService.errors.test.ts
tests/unit/invest/cashInTransit.test.ts
tests/unit/invest/reconcile/ReconciliationDiagnosticsService.dailyAudit.test.ts
```

Tambem existe `tasks/ARQUITETURA_INVEST_PLANO_DEFINITIVO.md` como arquivo nao rastreado no status atual.

## Estado git atual

Ultimo status observado:

```text
## codex-guto...origin/codex-guto
 M src/controllers/InvestController.ts
 M src/core/invest/AutoPendingSettlementSync.ts
 M src/core/invest/LedgerImportService.ts
 M src/core/invest/PatrimonyDailyEngine.ts
 M src/core/invest/PatrimonyDailyRecorder.ts
 M src/core/invest/PatrimonyMtmDailyEngine.ts
 M src/core/invest/cashInTransit.ts
 M src/core/invest/cashInvestLedger.ts
 M src/core/invest/reconcile/ReconciliationDiagnosticsService.ts
 M tests/unit/invest/AutoPendingSettlementSync.test.ts
 M tests/unit/invest/LedgerImportService.errors.test.ts
 M tests/unit/invest/cashInTransit.test.ts
 M tests/unit/invest/reconcile/ReconciliationDiagnosticsService.dailyAudit.test.ts
?? tasks/ARQUITETURA_INVEST_PLANO_DEFINITIVO.md
```

Este documento tambem deve aparecer como novo arquivo apos salvo.

## Pontos remanescentes importantes

### A. `settlementCalendar.ts` ainda existe como legado

Ainda ha referencias em:

- `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`
- `src/core/invest/btgHomeBrokerImport.ts`
- `src/core/invest/cashInTransit.ts`
- `src/core/invest/PatrimonyDailyEngine.ts`
- testes de `settlementCalendar`

Notas:

- O caminho principal de importacao agora corrige `settlement_date` via `LedgerImportService`.
- Mesmo assim, o objetivo arquitetural final deve ser reduzir `settlementCalendar.ts` a utilitario de calendario, nao fonte de regra de negocio.
- `cashInTransit.ts` ainda usa fallback legado para previsao visual quando uma pendencia antiga nao tem `settlement_date`. Isto e compatibilidade, nao ideal final.

### B. Parsers/tradutores ainda podem calcular datas legadas

Arquivos:

- `btgBrokerageNoteLedgerTranslator.ts`
- `btgHomeBrokerImport.ts`

Recomendacao:

- Manter API sincrona dos parsers.
- Nao mover `SettlementRulesService` para parser.
- Preferir helpers async no service/orquestrador antes de persistir, como foi feito em `LedgerImportService`.
- Depois, remover o preenchimento legado nos parsers ou deixar apenas como fallback sem autoridade.

### C. Hardcodes de tipos ainda aparecem fora do caminho principal

Exemplos a auditar:

- `src/core/invest/portfolioMapper.ts`
- `src/core/invest/PnLPivotEngine.ts`
- `src/core/invest/StockUnderlyingPivotEngine.ts`
- `src/core/invest/CustodyEngine.ts`
- `src/core/invest/brokerOrderMapper.ts`
- `src/core/invest/callCoverage.ts`
- `src/core/invest/MyProfitHistoricalParser.ts`

Direcao:

- Substituir decisoes de patrimonio/cotacao por `AssetValuationContext`.
- Substituir decisoes de agrupamento operacional por categorias/contratos do modulo.
- Nao trocar tudo mecanicamente: alguns nomes como `stock pivot` sao telas especificas e podem continuar como dominio de UI, desde que nao controlem arquitetura contabil.

### D. Renda fixa ainda precisa fechamento arquitetural completo

Consenso do usuario:

- Renda fixa e ativo como qualquer outro.
- Deve ter quantidade e PU/cotacao diaria.
- Nao deve ser tratada como caixa, exceto para exibicao junto do caixa por baixo risco/liquidez.
- Para dados antigos sem informacao detalhada, usar quantidade financeira e PU 1, mas ainda na mesma estrutura de ativo.

O que falta:

- Garantir migracao/backfill de RF antiga como posicao detalhada.
- Eliminar dependencia funcional de `fixed_income_total` como fonte de valor.
- Criar/ligar provider de cotacao Tesouro Direto (`tesouro_direto`) ou rotina de ingestao de PU.

### E. Cotacoes e fontes

Ainda falta:

- Adapter/provider real para `tesouro_direto`.
- Validar se `market_quote_source_mappings` cobre todos os tipos atuais.
- Validar US stocks/crypto com FX para patrimonio em BRL.

### F. Validacao final antes de commit

Antes de commit/push, outro agente deve rodar:

```powershell
npm run build
node .\node_modules\jest\bin\jest.js --selectProjects unit-core --runInBand
```

Se o teste completo ficar muito demorado, ao menos repetir a bateria focada registrada acima.

## Ordem recomendada para proximo agente

1. Revisar o diff atual com `git diff`.
2. Conferir se este documento reflete o estado local.
3. Rodar `npm run build`.
4. Rodar a bateria focada de testes.
5. Auditar hardcodes remanescentes com:

```powershell
rg -n "stock_cash_settlement_days|B3_STOCK_PAYMENT_BUSINESS_DAYS|cashSettlementDate|defersCashSettlement|resolveAssetTypeForSettlement|assetType === 'stock'|assetType === 'fii'|type === 'stock'|type === 'fii'|fixed_income_total" src\core\invest src\modules\invest src\controllers tests\unit\invest
```

6. Priorizar RF detalhada e provider de PU/cotacao.
7. So depois atacar pivots/UI especificos, para nao misturar arquitetura contabil com apresentacao.

## Observacao para commit

Nao foi feito commit nesta etapa de handoff. As alteracoes estao locais em `codex-guto`.

