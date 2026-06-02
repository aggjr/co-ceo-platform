# INVEST - Conciliacao Option C: arquitetura e handoff

> Autor: codex-guto  
> Status: handoff arquitetural da implementacao em homologacao  
> Ultima revisao: 2026-06-02  
> Versao base observada: V0.0.255

Este documento explica a arquitetura atualmente usada na tela de Conciliacao do INVEST e registra as decisoes tomadas para que outro agente consiga assumir o trabalho sem perder contexto.

## 1. Objetivo da funcao

A conciliacao Option C deve permitir reconstruir a carteira da holding a partir da abertura confiavel de 2026-01-01, usando:

- notas de corretagem BTG em PDF;
- extratos financeiros BTG em PDF, CSV ou TXT;
- fechamentos mensais do home broker como ancora aproximada, quando disponiveis;
- cotacoes e engines de patrimonio para gravar o grafico diario.

O objetivo pratico neste momento e colocar a aplicacao no ar em homologacao, com dados de teste, permitindo apagar e refazer a base quantas vezes forem necessarias. A arquitetura futura devera ficar mais rigida e auditavel, mas a fase atual prioriza replay controlado, logs claros e recuperacao rapida.

## 2. Fonte de verdade

A fonte de verdade da conciliacao e o livro canonico:

- `business_events`
- `patrimony_ledger_entries`
- `financial_ledger_entries`
- `patrimony_items`
- `invest_position_ext`
- `invest_option_ext`
- `invest_portfolio_daily`

Arquivos enviados pelo usuario nao devem virar fonte permanente. Eles sao lidos na sessao, parseados e transformados em eventos e pernas de ledger.

## 3. Decisao central: evento de negocio liga ativo e financeiro

A decisao mais importante e que toda operacao economica relevante deve gerar um `business_event`.

O `business_event_id` e o elo entre:

- a perna patrimonial, por exemplo compra, venda, exercicio, aluguel ou ajuste de custo;
- a perna financeira, por exemplo saldo em transicao, liquidacao em D+n, taxa, IRRF ou movimento de caixa;
- a origem externa, por exemplo nota BTG ou linha de extrato.

Sem esse elo, o sistema ate consegue calcular linhas isoladas, mas nao consegue explicar "este dinheiro liquidou aquela operacao de ativo". A conciliacao deve caminhar nessa direcao.

## 4. Identificadores usados

### `event_source_ref`

Chave agregadora do `business_event`.

Exemplos:

- `BTG-NOTA-{noteNumber}` para uma nota de corretagem.
- `OPENING:2026-01-01` para a abertura.
- `BTG-TD:{date}:{ticker}` para operacoes de Tesouro Direto extraidas do extrato.
- `BTG-BTC-PRIO3:{yyyy-mm}` para eventos mensais de BTC PRIO3.

Varias pernas podem carregar o mesmo `event_source_ref` e cair no mesmo `business_events.id`.

### `broker_note_ref`

Chave de idempotencia da perna individual.

Exemplos:

- `BTG-NOTA-{noteNumber}#{pregaoDate}#{lineNo}`
- `AUTO-D2:{patrimony_ledger_entry_id}`
- `AUTO-D2:{patrimony_ledger_entry_id}:CLEAR`
- `BTG-EXT-{date}#{seq}`

O `broker_note_ref` nao deve ser usado como header do evento. Ele evita duplicar a mesma perna em reimportacoes.

## 5. Fluxo atual Option C

### 5.1 Preparacao de homologacao

A tela permite resetar a base preservando a abertura confiavel.

Servico relacionado:

- `HoldingPurgeKeepOpeningService`

Regra: manter dados de abertura de 2026-01-01 e apagar o restante para replay.

### 5.2 Notas primeiro

A fase de notas usa os PDFs de corretagem e cria as pernas patrimoniais.

Arquivos principais:

- `src/core/invest/reconcile/reconcileNotesIndex.ts`
- `src/core/invest/btgBrokerageNoteParser.ts`
- `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`
- `src/core/invest/LedgerImportService.ts`
- `src/modules/invest/InvestOperations.ts`

Decisoes:

- As notas sao processadas em ordem cronologica por `pregaoDate`.
- Cada nota gera `event_source_ref = BTG-NOTA-{noteNumber}`.
- Cada trade vira uma ou mais `LedgerImportLine`.
- `InvestOperations.recordOperation` resolve ou cria o `business_event`.
- As pernas patrimoniais gravadas recebem `business_event_id`.

### 5.3 Saldo em transicao D+n

Operacoes com ativos podem refletir no financeiro em D+n:

- opcoes: premio normalmente D+1;
- acoes e FIIs: liquidacao normalmente D+2;
- outros ativos seguem regra de `settlementCalendar`.

Arquivo principal:

- `src/core/invest/AutoPendingSettlementSync.ts`

Decisao implementada em V0.0.255:

- O replay historico deve criar a pendencia no dia D mesmo quando a data ja esta no passado.
- A baixa da pendencia deve ser criada no dia de liquidacao D+n.
- A pendencia e a baixa devem herdar o `business_event_id` da operacao patrimonial que as originou.

Isso permite reconstruir corretamente:

- Saldo atual;
- Saldo em transicao;
- patrimonio diario;
- relacao ativo-financeiro.

Antes dessa decisao, o sincronismo criava pendencias apenas se a liquidacao ainda estivesse no futuro em relacao a "hoje". Isso prejudicava o replay historico de janeiro a maio de 2026.

### 5.4 Extratos depois

A fase de extratos entra depois das notas.

Arquivos principais:

- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/BtgExtractLineParser.ts`
- `src/core/invest/btgExtractBatchReconcile.ts`
- `src/core/invest/btgExtractCashSeries.ts`

O parser classifica linhas do extrato em:

- movimentos financeiros puros, como TED, rendimento, multa;
- custos vinculaveis a ativos, como IRRF ou taxa;
- movimentos agregados de bolsa, como `LIQ BOLSA`;
- linhas ignoradas ou informativas.

### 5.5 `LIQ BOLSA` agregado

`LIQ BOLSA` no extrato e um valor financeiro agregado. Ele representa liquidacoes de operacoes de bolsa, mas nao traz sozinho todas as linhas de ativos.

Decisao implementada em V0.0.255:

- Antes de importar o extrato, o sistema chama `ledger.reconcileCustody(ctx)` para materializar pendencias automaticas.
- O importador procura pendencias `AUTO-D2:*` com `settlement_date` igual a data do `LIQ BOLSA`.
- Se a soma das pendencias do dia bater com o valor agregado do `LIQ BOLSA`, a linha agregada e quebrada em varias linhas financeiras.
- Cada linha quebrada recebe o `business_event_id` da pendencia correspondente.
- Se a soma nao bater, a linha agregada e mantida e registrada em log para analise.

Funcao adicionada:

- `expandLiqBolsaByBusinessEvent`

Log emitido:

- `btg-extract.liq-bolsa.business-events`

Essa e uma solucao pragmatica de homologacao. A versao auditavel futura deve guardar explicitamente o relacionamento entre linha de extrato agregada e cada liquidacao individual.

## 6. Grafico diario de patrimonio

A tela de Conciliacao deve caminhar dia a dia, e cada fechamento deve alimentar o patrimonio diario.

Arquivos relacionados:

- `src/core/invest/reconcile/DailyCloseMaterializeService.ts`
- `src/core/invest/PatrimonyDailyRecorder.ts`
- `src/core/invest/PatrimonyDailyRebuildService.ts`
- `src/core/invest/PatrimonyMtmDailyEngine.ts`
- `src/core/invest/PatrimonyDailyEngine.ts`

Decisao atual:

- A materializacao diaria deve ocorrer conforme o replay avanca.
- O grafico deve refletir livro canonico e cotacoes, nao dados soltos.
- Home broker mensal pode ser usado como ancora auxiliar, especialmente para estimar opcoes sem cotacao diaria disponivel.

Ponto ainda sensivel:

- Em homologacao, o sistema pode usar interpolacao e ancoras mensais para aproximar valores.
- Na versao auditavel, essa interpolacao deve ser marcada como estimativa, com fonte, data e justificativa.

## 7. Tres precos dos ativos

O sistema trabalha com tres visoes de preco/custo:

- preco estrito;
- preco B3 ou fiscal;
- preco gerencial.

Arquivos relacionados:

- `src/core/invest/threePricesEngine.ts`
- `src/core/invest/StockUnderlyingPivotEngine.ts`
- `src/modules/invest/InvestOperations.ts`

Decisao:

- Operacoes de compra, venda, opcao e ajustes devem alimentar o ledger.
- O calculo dos tres precos deve derivar do ledger, nao da tela.
- Custos como IRRF, taxas, custodia e juros devem ser classificados de forma explicita para indicar se afetam ou nao o preco B3.

Campo relevante:

- `LedgerImportLine.applies_to_b3`

## 8. UI e observabilidade

A tela atual de Conciliacao foi simplificada para homologacao.

Decisoes visuais recentes:

- Um unico botao principal para processar o fluxo.
- Barra de progresso.
- Logs visiveis na tela.
- Logs tambem enviados ao console do navegador com prefixo `[invest:reconcile:ui]`.
- Tabelas estilo Excel para arquivos lidos, logs e conferencia, usando componente padronizado do projeto.
- Imagens e botoes nao usados foram comentados ou ocultados temporariamente.

Arquivos relacionados:

- `frontend/src/pages/InvestConciliacaoPage.js`
- `frontend/src/styles/invest-conciliacao.css`
- componentes de ExcelTable usados tambem na tela de Opcoes Visao tabela Excel.

Observabilidade servidor:

- `src/core/invest/reconcile/reconcileErrorDetail.ts`
- eventos de log como `option-c.run.start`, `option-c.extracts.done`, `btg-extract.file.error`, `btg-extract.liq-bolsa.business-events`.

## 9. Execucao em background

A conciliacao pode demorar por causa de:

- leitura de muitos PDFs;
- parsing de notas;
- sincronismo de cotacoes;
- fechamento diario;
- materializacao de patrimonio;
- calculo de opcoes e tres precos.

Decisao recente:

- O fluxo pesado deve rodar em background no servidor.
- A UI deve fazer polling de progresso.
- A requisicao HTTP nao deve ficar presa ate terminar o processamento completo.

Arquivos relacionados:

- `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`
- `src/controllers/ReconcileController.ts`
- rotas em `src/routes/api.ts`

## 10. Como o sistema deve funcionar, em termos de negocio

Sequencia desejada:

1. Preservar abertura de 2026-01-01.
2. Apagar dados posteriores, quando o usuario escolher reset.
3. Ler notas de corretagem.
4. Para cada dia de pregao:
   - importar eventos patrimoniais das notas;
   - criar saldos em transicao financeiros D+n;
   - atualizar carteira;
   - calcular tres precos;
   - gravar patrimonio diario;
   - registrar pendencias se houver divergencia.
5. Ler extratos financeiros.
6. Para cada linha financeira:
   - classificar;
   - se for movimento puro, registrar como evento financeiro;
   - se for custo vinculado a ativo, registrar ajuste com evento apropriado;
   - se for `LIQ BOLSA`, tentar ligar as liquidacoes aos eventos das notas.
7. Usar fechamentos mensais do home broker como ancoras auxiliares.
8. Exibir saldo atual e saldo em transicao.
9. Exibir grafico diario e carteira coerentes com o livro.

## 11. Pontos que ainda precisam evoluir

### 11.1 Extrato ainda e fase posterior

O fluxo atual ainda processa notas primeiro e extratos depois. O desejo de produto e caminhar dia a dia com os dois lados juntos.

Proximo passo recomendado:

- transformar a fase de extratos em calendario diario junto com notas;
- fechar um dia apenas depois de ativos e financeiro daquele dia estarem reconciliados;
- manter fase de homologacao permissiva, mas com pendencias visiveis.

### 11.2 Matching de `LIQ BOLSA` e pragmatico

Hoje o matching de `LIQ BOLSA` depende de data, sinal e soma das pendencias.

Na versao auditavel:

- criar tabela ou metadata de relacionamento entre linha de extrato e liquidacoes;
- registrar tolerancia;
- registrar quem confirmou;
- permitir revisao posterior.

### 11.3 Home broker mensal precisa contrato formal

Os JSONs mensais do home broker podem servir como ancoras.

Ainda precisa formalizar:

- schema esperado;
- campo `referenceDate`;
- quais totais sao confiaveis;
- como interpolar opcoes;
- como marcar valor estimado versus valor observado.

### 11.4 Regras de custos por ativo

Custos financeiros ainda podem cair como movimento financeiro puro quando nao ha ticker claro.

Na versao futura:

- padronizar regra de alocacao;
- tornar alocacao visivel para o usuario;
- criar evento de negocio composto para custos rateados.

### 11.5 Auditoria estrita

Ainda falta um modo rigido para:

- impedir fechamento com pernas orfas;
- impedir `business_event` sem perna;
- impedir soma financeira divergente;
- bloquear duplicidade de `external_ref`;
- listar todas as divergencias como decisoes explicitas.

Documentos relacionados:

- `docs/architecture/business_events_integration_plan.md`
- `docs/architecture/invest_reconciliacao_sessao.md`
- `docs/architecture/invest_conciliacao.md`

## 12. Checklist para outro agente assumir

Antes de alterar codigo:

1. Ler este documento.
2. Ler `business_events_integration_plan.md`.
3. Ler `invest_reconciliacao_sessao.md`.
4. Verificar branch atual e worktree limpa.
5. Rodar `rg "business_event_id|event_source_ref|AUTO-D2|LIQ BOLSA" src/core/invest src/modules/invest`.
6. Entender se a alteracao e de homologacao permissiva ou de auditoria estrita.

Ao mexer no fluxo:

1. Nao criar writes fora de `InvestOperations.recordOperation` sem motivo forte.
2. Nao quebrar idempotencia de `broker_note_ref`.
3. Nao remover `business_event_id` de pernas patrimoniais ou financeiras.
4. Nao tratar `LIQ BOLSA` como verdade unica quando houver pendencias de nota para ligar.
5. Sempre preservar abertura de 2026-01-01 em reset de homologacao.
6. Sempre emitir log de servidor e, quando for UI, log no console F12.
7. Rodar `npm run build`.
8. Rodar `npm run check:branch-overlap` antes de integrar.

## 13. Arquivos centrais

Backend:

- `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`
- `src/core/invest/reconcile/ReconciliationSessionService.ts`
- `src/core/invest/reconcile/DailyCloseMaterializeService.ts`
- `src/core/invest/reconcile/reconcileNotesIndex.ts`
- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/BtgExtractLineParser.ts`
- `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`
- `src/core/invest/AutoPendingSettlementSync.ts`
- `src/core/invest/LedgerImportService.ts`
- `src/modules/invest/InvestOperations.ts`
- `src/modules/invest/sync/LedgerEventProjection.ts`

Frontend:

- `frontend/src/pages/InvestConciliacaoPage.js`
- `frontend/src/styles/invest-conciliacao.css`

Rotas e controller:

- `src/controllers/ReconcileController.ts`
- `src/controllers/InvestController.ts`
- `src/routes/api.ts`

Docs:

- `docs/architecture/invest_conciliacao.md`
- `docs/architecture/invest_reconciliacao_sessao.md`
- `docs/architecture/business_events_integration_plan.md`

## 14. Frase guia

A conciliacao nao e apenas importar PDFs. Ela deve transformar notas, extratos e ancoras em eventos de negocio explicaveis, onde cada mudanca na carteira tenha sua consequencia financeira vinculada, e cada movimento financeiro consiga apontar qual evento patrimonial ou financeiro o gerou.
