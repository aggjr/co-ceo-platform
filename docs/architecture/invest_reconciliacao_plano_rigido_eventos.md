# INVEST - plano rigido de reconciliacao por eventos de negocio

> Autor: codex-guto  
> Criado em: 2026-06-03  
> Status: documento mestre para agentes que forem corrigir a reconciliacao INVEST  
> Objetivo atual: carteira correta, financeiro correto, 3 precos corretos, patrimonio diario correto, PRIO/CDI e demais curvas corretas.

Este documento deve ser lido antes de qualquer nova alteracao no fluxo INVEST. Ele substitui, para o objetivo atual, leituras longas de arquitetura geral. Use outros docs apenas como referencia auxiliar.

## 0. Estado atual antes de continuar

Esta anotacao existe porque a sessao anterior foi interrompida no meio de uma implementacao.

No momento da criacao deste documento, o working tree tinha alteracoes parciais nestes arquivos:

- `src/core/business-events/BusinessEventRegistry.ts`
- `src/core/financial/FinancialLedger.ts`
- `src/core/inventory/InventoryLedger.ts`
- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/reconcile/reconcileNotesIndex.ts`
- `src/modules/invest/InvestOperations.ts`

Essas alteracoes nao devem ser consideradas finalizadas. Antes de qualquer build, commit ou integrate, o proximo agente deve:

1. Rodar `git diff` nesses arquivos.
2. Decidir se vai completar a implementacao ou limpar as mudancas parciais.
3. Nao misturar meio-termo com outras tarefas.
4. Rodar `npm run build` somente depois de resolver o estado parcial.

Comando obrigatorio antes de mexer:

```bash
git diff src/core/business-events/BusinessEventRegistry.ts \
         src/core/financial/FinancialLedger.ts \
         src/core/inventory/InventoryLedger.ts \
         src/core/invest/btgUploadImportService.ts \
         src/core/invest/reconcile/reconcileNotesIndex.ts \
         src/modules/invest/InvestOperations.ts
```

Decisao esperada na fase 0:

- preservar a intencao arquitetural das mudancas, porque elas atacam problemas reais;
- corrigir as que ficaram incompletas antes de qualquer build;
- nao integrar o estado parcial como esta.

Pontos parciais identificados originalmente na fase 0:

- `BusinessEventRegistry.addToTotalNet`: util para agregar valor liquido de uma nota com varias pernas, mas deve ser idempotente; se uma importacao repetir, nao pode somar de novo.
- `FinancialLedger.record`: exigir `businessEventId` e correto, mas todos os chamadores precisam ser ajustados antes de build.
- `InventoryLedger.recordMovement`: exigir `businessEventId` e correto, mas todos os chamadores precisam ser ajustados antes de build.
- `btgUploadImportService`: comecou a bloquear cadeia quebrada e `LIQ BOLSA` nao casado, mas ficou referencia quebrada a variavel removida; resolver antes de testar.
- `reconcileNotesIndex`: suprimir caixa de notas evita duplicidade, mas o fluxo precisa criar liquidacoes esperadas para casamento posterior com o extrato.
- `InvestOperations.recordOpeningCash`: abertura via ledger/evento e correta, mas a migracao precisa ser idempotente e validada.

### 0.1 Registro de execucao da fase 0

Executado por codex-guto em 2026-06-03.

Decisao tomada:

- preservar as travas estruturais de `businessEventId` nos ledgers;
- preservar abertura de caixa via ledger/evento, com `financial_accounts.opening_balance = 0` no caminho novo;
- preservar a supressao de caixa nas notas quando o extrato e a fonte de caixa;
- bloquear cadeia de extrato quebrada em vez de injetar ajuste automatico;
- bloquear `LIQ BOLSA` nao casado em vez de gravar como caixa avulso;
- remover a tentativa nao idempotente de `BusinessEventRegistry.addToTotalNet`.

Validacao:

- `npm run build` executado com sucesso em 2026-06-03.

Observacao:

- a fase 0 deixa o codigo compilavel e tira o estado parcial perigoso;
- ainda nao significa que a reconciliacao final esteja correta;
- as fases 1 a 6 continuam obrigatorias antes de confiar novamente em carteira, caixa, 3 precos e patrimonio diario.

## 1. Principio central

Toda alteracao em qualquer lado deve ter uma explicacao de negocio.

Isso vale para:

- entrada ou saida de ativo;
- mudanca de quantidade;
- exercicio de opcao;
- split, bonificacao ou grupamento;
- mudanca de custo medio;
- entrada ou saida de caixa;
- saldo em transito;
- rendimento de caixa;
- taxa, IRRF, multa, custodia;
- aporte ou retirada;
- ajuste manual excepcional.

A explicacao de negocio e sempre um registro em `business_events`.

Um `business_event` pode ter:

- pernas apenas patrimoniais;
- pernas apenas financeiras;
- pernas nos dois lados.

Mas nao pode existir perna em `patrimony_ledger_entries` ou `financial_ledger_entries` sem `business_event_id`.

## 2. Modelo canonico

### 2.1 Header

Tabela:

- `business_events`

Representa o fato gerador.

Exemplos:

- nota BTG de corretagem;
- linha de extrato de rendimento;
- LIQ BOLSA que liquida uma ou mais operacoes;
- abertura de 2026-01-01;
- split de acao;
- ajuste manual aprovado.

Campos importantes:

- `event_kind`: tipo do fato;
- `occurred_on`: data economica do fato;
- `settles_on`: data esperada de liquidacao;
- `source_ref`: chave externa agregadora;
- `total_net`: impacto financeiro liquido esperado;
- `metadata`: detalhes, origem, parser, status de conciliacao.

### 2.2 Pernas patrimoniais

Tabela:

- `patrimony_ledger_entries`

Representa o que mudou na carteira:

- `acquisition`
- `disposition`
- `opening_balance`
- `split`
- `bonus`
- `revaluation`
- `cost_adjustment`

Regra rigida:

- toda linha deve ter `business_event_id`;
- se mover caixa tambem, deve apontar para a perna financeira correspondente por `related_financial_entry_id`;
- a quantidade atual da carteira deve ser derivada do replay dessas pernas.

### 2.3 Pernas financeiras

Tabela:

- `financial_ledger_entries`

Representa dinheiro, saldo em transito ou caixa liquidado.

Regra rigida:

- toda linha deve ter `business_event_id`;
- se estiver ligada a ativo, deve apontar para a perna patrimonial correspondente por `related_patrimony_ledger_id`;
- se for financeiro puro, continua tendo `business_event_id` proprio, por exemplo rendimento overnight.

## 3. Decisao obrigatoria sobre abertura

A abertura confiavel e 2026-01-01.

Para evitar duplicidade:

- `financial_accounts.opening_balance` deve ser `0` para contas INVEST novas;
- o saldo inicial deve existir como perna em `financial_ledger_entries`;
- essa perna deve estar ligada ao evento `OPENING:2026-01-01`;
- os ativos iniciais tambem devem estar ligados ao mesmo evento de abertura.

Nao somar `financial_accounts.opening_balance` e perna de abertura ao mesmo tempo.

Se a base atual tiver os dois, o agente deve corrigir antes de confiar no caixa.

### 3.1 Migracao exata de `financial_accounts.opening_balance`

Esta migracao existe para preservar o saldo inicial sem soma dupla.

Pre-condicao:

- usar somente contas INVEST da organizacao em reconciliacao;
- considerar 2026-01-01 como data de abertura confiavel;
- nao apagar dados antes de medir saldo antes/depois.

Algoritmo idempotente:

1. Para cada `financial_accounts` INVEST, ler:
   - `id`;
   - `opening_balance`;
   - `opening_date`.
2. Definir `openingDate = opening_date || '2026-01-01'`.
3. Garantir um evento de abertura unico da carteira:
   - `source_module = 'INVEST'`;
   - `event_kind = 'opening_balance'`;
   - `occurred_on = '2026-01-01'`;
   - `settles_on = '2026-01-01'`;
   - `source_ref = 'INVEST-OPENING-2026-01-01'`;
   - `total_net = 0`;
   - `metadata.kind = 'trusted_opening_snapshot'`.
4. Procurar uma perna financeira de abertura ja existente para a conta:
   - `account_id = financial_accounts.id`;
   - `transaction_date = openingDate`;
   - `business_event_id = openingEvent.id`;
   - `metadata.legacy_op = 'opening_balance'` ou descricao equivalente a "Saldo inicial".
5. Se a perna existir:
   - validar que o valor dela equivale ao `opening_balance` atual quando `opening_balance != 0`;
   - se houver divergencia maior que R$ 0,01, bloquear e pedir decisao manual;
   - se bater, atualizar `financial_accounts.opening_balance = 0`.
6. Se a perna nao existir e `opening_balance != 0`:
   - criar `financial_ledger_entries` com:
     - `business_event_id = openingEvent.id`;
     - `transaction_date = openingDate`;
     - `settlement_date = openingDate`;
     - `amount = abs(opening_balance)`;
     - `direction = 'inflow'` se `opening_balance >= 0`;
     - `direction = 'outflow'` se `opening_balance < 0`;
     - `status = 'cleared'`;
     - `external_ref = 'OPENING-CASH-' + account_id + '-2026-01-01'`;
     - `metadata.legacy_op = 'opening_balance'`;
     - `metadata.migrated_from = 'financial_accounts.opening_balance'`.
   - atualizar `financial_accounts.opening_balance = 0`.
7. Se `opening_balance = 0` e ja existe perna de abertura, nao criar nada.
8. Recalcular saldo ate 2026-01-01 antes e depois da migracao; o resultado deve ser igual.

Regra de seguranca:

- depois da migracao, qualquer calculo de saldo INVEST deve tratar `financial_accounts.opening_balance` como zero quando existir perna de abertura;
- reset de homologacao deve preservar o evento `INVEST-OPENING-2026-01-01` e suas pernas financeiras/patrimoniais;
- nunca criar uma segunda abertura para "corrigir" caixa.

## 4. Contrato de data e saldo em transito

### 4.1 Operacoes com ativo

Uma compra/venda de ativo tem:

- data da operacao: pregao;
- data de liquidacao financeira: D+n;
- efeito na carteira: no dia do pregao, para fins gerenciais;
- efeito no caixa liquidado: somente na data de liquidacao confirmada.

Exemplos:

- acoes/FIIs: D+2 uteis;
- premio de opcao: D+1 util;
- renda fixa: regra especifica por ativo, mas normalmente D+1.

### 4.2 Modelo correto de caixa

O sistema deve manter duas visoes:

- saldo atual/liquidado;
- saldo em transito.

Formula desejada:

- `saldo_liquidado(date)`: apenas financeiro confirmado/liquidado ate a data;
- `saldo_transito(date)`: obrigações/recebiveis de operacoes ja ocorridas e ainda nao liquidadas;
- `caixa_total_gerencial(date) = saldo_liquidado + saldo_transito`.

Erro proibido:

- usar `caixa_total_gerencial` e depois somar `saldo_transito` de novo no patrimonio.

Ponto atual a revisar:

- `PatrimonyMtmDailyEngine.economicCashAtDate` retorna `cashIncludingTransit`;
- depois `PatrimonyMtmDailyEngine` soma `pendingSettlements` novamente;
- isso e candidato forte a gerar patrimonio absurdo.

## 5. Contrato para notas BTG

### 5.1 Evento por nota

Cada nota deve gerar um unico `business_event`.

Chave:

- `event_source_ref = BTG-NOTA-{noteNumber}`

Cada linha da nota vira uma ou mais pernas patrimoniais.

O `broker_note_ref` continua sendo chave da perna individual, nao do evento.

### 5.2 Total liquido da nota

O `business_events.total_net` da nota deve ser o total liquido agregado da nota, nao o valor da primeira linha.

Se o parser gera N linhas para a mesma nota, o total deve ser:

- pre-agregado antes de criar o header; ou
- acumulado no header durante a importacao de todas as linhas.

Nao deixar `total_net` com valor parcial.

### 5.3 Caixa da nota

No fluxo atual com extrato como fonte de caixa:

- a nota nao deve criar caixa liquidado definitivo;
- a nota deve criar a perna patrimonial;
- a nota deve criar ou permitir gerar expectativa de liquidacao D+n;
- a linha do extrato deve confirmar/liquidar o financeiro.

Se o fluxo permitir caixa pela nota e caixa pelo extrato, ha risco alto de duplicidade.

## 6. Contrato para extratos BTG

### 6.1 Linhas financeiras puras

Exemplos:

- TED;
- rendimento de caixa;
- taxa sem relacao com ativo;
- aporte;
- retirada.

Cada uma deve virar um `business_event` financeiro proprio.

Elas nao precisam ter perna patrimonial, mas precisam ter evento.

### 6.2 Custos ligados a ativos

Exemplos:

- IRRF ligado a operacao;
- taxa de custodia de ativo;
- custo de aluguel;
- juros/multa alocavel.

Devem virar:

- evento de negocio;
- perna financeira;
- se aplicavel, perna patrimonial `cost_adjustment` no ativo correto.

Se nao for possivel alocar ao ativo, registrar como pendencia, nao inventar alocacao silenciosa.

### 6.3 LIQ BOLSA

`LIQ BOLSA` nao e aporte e nao e retirada.

`LIQ BOLSA` representa confirmacao financeira de operacoes de bolsa.

Regra rigida:

1. Buscar pendencias/operacoes D+n com mesma data de liquidacao.
2. Casar por `business_event_id`, valor, sinal e tolerancia.
3. Se casar, confirmar/liquidar aquelas pendencias no mesmo evento.
4. Se nao casar, bloquear a importacao daquele extrato ou registrar pendencia critica.
5. Nunca transformar `LIQ BOLSA` nao casado em `capital_deposit` ou `capital_withdrawal`.

Erro proibido:

- manter `LIQ BOLSA` agregado como caixa avulso quando existem pendencias de operacoes no mesmo dia.

### 6.4 Algoritmo exato para casar `LIQ BOLSA` com multiplas operacoes

Objetivo:

- uma linha agregada de `LIQ BOLSA` do extrato pode liquidar uma ou varias notas/eventos;
- o sistema deve decompor a linha agregada em liquidacoes por `business_event_id`;
- se houver ambiguidade ou sobra, bloquear.

Normalizacao obrigatoria:

1. Converter o valor da linha do extrato para impacto de caixa da holding:
   - entrada de dinheiro = positivo;
   - saida de dinheiro = negativo.
2. Converter todos os valores para centavos inteiros antes do casamento.
3. Usar tolerancia maxima de 1 centavo por linha de extrato.
4. Considerar somente a mesma organizacao, mesma conta/corretora e mesma moeda.

Conjunto candidato:

Para uma linha `LIQ BOLSA` com data `D` e valor assinado `V`, buscar eventos:

- `business_events.settles_on = D`;
- `event_kind` ligado a bolsa, por exemplo:
  - `buy`;
  - `sell`;
  - `put_buy`;
  - `put_sell`;
  - `call_buy`;
  - `call_sell`;
  - `exercise`;
  - `assignment`;
  - `securities_lending`, se liquidado por bolsa;
- evento nao cancelado/anulado;
- evento ainda nao totalmente liquidado;
- `expectedUnsettledCents != 0`.

Calculo do pendente por evento:

```text
expectedCents(event) =
  roundToCents(business_events.total_net)

clearedCents(event) =
  soma assinada das financial_ledger_entries cleared
  do mesmo business_event_id
  que representam liquidacao de bolsa

pendingCents(event) =
  expectedCents(event) - clearedCents(event)
```

Sinal:

- compra gera `pendingCents < 0`;
- venda gera `pendingCents > 0`;
- premio de opcao vendido gera `pendingCents > 0`;
- premio de opcao comprado gera `pendingCents < 0`.

Casamento deterministico:

1. Se a soma de todos os `pendingCents` candidatos da data for igual a `V`, usar todos.
2. Senao, procurar subconjunto cuja soma seja exatamente `V`.
3. A busca de subconjunto deve ser deterministica:
   - ordenar por `settles_on`, `occurred_on`, `source_ref`, `id`;
   - usar centavos inteiros;
   - aceitar apenas soma exata ou diferenca absoluta de ate 1 centavo;
   - preferir o conjunto com menor diferenca;
   - em empate, preferir o conjunto com mais eventos quando todos sao da mesma nota;
   - em qualquer outro empate, bloquear como ambiguo.
4. Se nenhum subconjunto bater, bloquear.
5. Se houver mais de um subconjunto valido e indistinguivel, bloquear.

Resultado quando casa:

- nao criar evento proprio para a linha `LIQ BOLSA`;
- nao criar entrada agregada de caixa;
- para cada evento casado, criar ou confirmar uma perna financeira com:
  - `business_event_id = event.id`;
  - `transaction_date = D`;
  - `settlement_date = D`;
  - `amount = abs(pendingCents(event))/100`;
  - `direction = inflow/outflow` conforme sinal;
  - `status = 'cleared'`;
  - `external_ref = extractLineRef + '#' + event.source_ref`;
  - `metadata.kind = 'liq_bolsa_settlement'`;
  - `metadata.extract_line_ref = extractLineRef`;
  - `metadata.matched_business_event_id = event.id`;
  - `metadata.original_liq_bolsa_amount = V/100`.
- marcar a expectativa/pending anterior como liquidada, ou evitar cria-la se a arquitetura escolher apenas uma perna cleared no vencimento.

Resultado quando nao casa:

- nao gravar movimento financeiro de caixa;
- registrar pendencia critica no diagnostico;
- informar:
  - arquivo;
  - data;
  - valor `LIQ BOLSA`;
  - candidatos encontrados;
  - soma dos candidatos;
  - delta;
  - motivo: sem candidato, soma diferente ou ambiguo.

Regra contra duplicidade:

- se uma nota ja criou caixa liquidado definitivo, o casamento de `LIQ BOLSA` deve detectar e bloquear;
- o fluxo definitivo deve ser: nota cria ativo + expectativa; extrato confirma caixa.

## 7. Ajustes automaticos

Proibido gravar ajuste automatico para "fechar a conta" sem origem.

Exemplo proibido:

- `AJUSTE DE DIVERGENCIA BTG (Cadeia Quebrada)`

Se a cadeia de saldos do extrato quebra:

1. parar;
2. exibir arquivo, data, saldo esperado, saldo encontrado e delta;
3. registrar pendencia;
4. nao gravar movimento financeiro artificial.

Um ajuste manual pode existir no futuro, mas deve ter:

- evento proprio;
- usuario aprovador;
- justificativa;
- data;
- valor;
- relatorio de impacto.

## 8. Contrato dos 3 precos

Objetivo:

- PM estrito;
- PM B3/fiscal;
- PM gerencial.

Problema atual:

- existem motores distintos que podem divergir:
  - `ThreePricesValuation`;
  - `threePricesEngine.computeThreePricesByUnderlying`.

Regra para corrigir:

1. Escolher uma fonte canonica para INVEST.
2. O calculo deve usar apenas eventos ate `asOfDate`.
3. Nao usar eventos futuros para recalcular preco historico.
4. Vendas parciais nao devem alterar PM do lote remanescente.
5. Compras aumentam ou abrem lote e recalculam PM.
6. Exercicio de opcao deve aplicar premio conforme regra definida.
7. Custos devem indicar se afetam `pm_b3`.

Decisao definitiva:

- fonte canonica para INVEST: `src/core/invest/threePricesEngine.ts`;
- funcao canonica: `computeThreePricesByUnderlying(eventsAteAsOf)`;
- motor a ser eliminado do fluxo INVEST: `src/modules/invest/ThreePricesValuation.ts`.

O arquivo `ThreePricesValuation.ts` pode continuar existindo temporariamente por compatibilidade de testes/estrategias antigas do nucleo de inventario, mas nao deve ser usado para:

- tela INVEST;
- `/api/invest/portfolio/three-prices`;
- recalculo remoto;
- materializacao de `invest_position_ext`;
- patrimonio diario;
- historico as-of.

Plano de remocao segura:

1. Trocar todos os usos INVEST para `computeThreePricesByUnderlying(eventsAteAsOf)`.
2. Garantir que cada chamada filtre eventos por `transaction_date <= asOfDate`.
3. Atualizar testes para validar o motor canonico.
4. Marcar `ThreePricesValuation` como deprecated.
5. Remover registro/uso de `three_prices_invest` no INVEST quando nao houver importacoes diretas restantes.

Regra de gravacao:

- `invest_position_ext` deve guardar apenas snapshot/cache do resultado canonico;
- cache nunca e fonte de verdade;
- se houver divergencia entre cache e replay do ledger, o replay vence e o cache deve ser regravado.

## 9. Contrato de cotacoes

### 9.1 Acoes e FIIs

Cotacao diaria de fechamento e obrigatoria para cada dia util em que o ativo esta aberto.

Nao pode:

- usar preco atual como se fosse historico;
- usar PM como fallback em dia util;
- interpolar acao;
- jogar residuo de acao para opcoes.

Cadeia de fontes:

1. brapi, quando o range permitido entregar a data;
2. Yahoo/Stooq ou fonte historica equivalente;
3. Status Invest, Investidor10 ou outro provedor parseavel;
4. import/manual controlado, somente com metadata.

Se nao encontrar fechamento de acao em dia util:

- bloquear o dia;
- listar ticker e data;
- nao gravar `invest_portfolio_daily` como confiavel.

### 9.2 Opcoes

Ordem:

1. buscar preco observado em fonte externa;
2. cachear FOUND/NOT_FOUND por ticker/data/fonte;
3. se nao encontrar, permitir estimativa;
4. estimativa deve ser marcada como tal.

A estimativa pode usar:

- decaimento estrutural;
- interpolacao mensal;
- residuo contra ancoras mensais.

Mas somente depois de validar:

- cotacoes de acoes;
- caixa;
- renda fixa;
- quantidades.

### 9.3 CDI e benchmarks

CDI e benchmarks devem vir de serie diaria propria.

Nao calcular curva CDI a partir de ponto solto sem data diaria.

## 10. Contrato de patrimonio diario

Patrimonio do dia deve ser derivado de:

- carteira por ativo no dia;
- cotacao real de acoes/FIIs;
- preco observado ou estimado de opcoes;
- renda fixa validada;
- caixa liquidado;
- saldo em transito, uma unica vez;
- ancoras mensais somente como referencia/calibracao controlada.

Erro proibido:

- gravar patrimonio diario se faltam cotacoes obrigatorias;
- somar transito duas vezes;
- usar ancoras para mascarar erro de acao ou caixa;
- rodar rebuild ate "hoje" se as fontes confiaveis param antes.

O rebuild deve parar em:

- `lastTrustedDate`;
- ou data final explicitamente escolhida.

Nao usar `today` como padrao em replay historico.

## 11. Uso das ancoras mensais do home broker

As ancoras mensais sao uma regua de verificacao.

Elas devem ser usadas para:

- validar patrimonio total;
- validar rentabilidade mensal constatada;
- calibrar apenas itens sem preco observado, principalmente opcoes.

Elas nao devem ser usadas para:

- corrigir cotacao ausente de acao;
- corrigir caixa errado;
- corrigir duplicidade de LIQ BOLSA;
- esconder quantidade de ativo errada.

Ordem de explicacao de delta contra ancora:

1. falta/erro de cotacao de acao ou FII;
2. erro de caixa/extrato;
3. erro de renda fixa;
4. quantidade errada de ativo;
5. opcao sem preco observado;
6. residuo estimado de opcao.

Se qualquer item 1 a 4 existir, nao distribuir residuo em opcoes.

## 12. Fluxo correto de conciliacao dia a dia

Entrada:

- abertura confiavel de 2026-01-01;
- pasta de notas;
- pasta de extratos;
- arquivos de home broker/ancoras, se houver.

Processo:

1. Reset preservando abertura.
2. Indexar notas por `pregaoDate`.
3. Indexar extratos por data de movimento.
4. Para cada dia em ordem cronologica:
   - importar notas do dia;
   - criar/atualizar eventos de negocio;
   - criar pernas patrimoniais;
   - criar saldo em transito esperado;
   - importar linhas financeiras do extrato do dia;
   - confirmar liquidacoes D+n;
   - bloquear se LIQ BOLSA nao casar;
   - atualizar carteira;
   - recalcular 3 precos as-of;
   - validar cotacoes obrigatorias;
   - materializar patrimonio do dia somente se confiavel.
5. Ao final:
   - gerar diagnostico diario financeiro/eventos/carteira;
   - comparar com home broker;
   - gravar apenas dias confiaveis como oficiais.

## 13. Diagnostico obrigatorio em 3 planilhas

A tela e os relatorios devem exibir 3 visoes lado a lado.

### 13.1 Financeiro

Uma linha por dia:

- saldo liquidado inicial;
- saldo em transito inicial;
- movimentos ligados a ativos;
- movimentos puramente financeiros;
- variacao do transito;
- saldo em transito final;
- saldo liquidado final;
- detalhes por evento.

### 13.2 Eventos de negocio

Uma linha por evento ou agregacao diaria:

- `business_event_id`;
- tipo;
- origem;
- data do fato;
- data de liquidacao;
- pernas patrimoniais;
- pernas financeiras;
- valor esperado;
- valor liquidado;
- delta;
- status: ok, pendente, erro.

### 13.3 Ativos/carteira

Uma linha por dia e, quando necessario, por ativo:

- patrimonio inicial em carteira;
- ativo;
- quantidade inicial;
- entradas;
- saidas;
- quantidade final;
- preco considerado;
- valor inicial;
- valor final;
- delta;
- origem do preco.

## 14. Auditorias obrigatorias

Antes de considerar a conciliacao valida:

### 14.1 Integridade estrutural

- zero pernas patrimoniais sem `business_event_id`;
- zero pernas financeiras sem `business_event_id`;
- zero eventos sem perna, exceto eventos explicitamente anulados;
- zero pernas linkadas a evento de outra organizacao;
- zero `LIQ BOLSA` agregado nao explicado.

### 14.2 Carteira

- quantidade por ticker no replay igual a `patrimony_items`;
- quantidade por ticker igual ao snapshot home broker na data disponivel;
- opcoes abertas com sinal correto;
- exercicios baixam opcoes corretamente;
- splits/bonus nao alteram valor total indevidamente.

### 14.3 Financeiro

- saldo liquidado bate com extrato;
- saldo em transito bate com liquidacoes pendentes;
- entradas/saidas de capital nao incluem LIQ BOLSA;
- nenhum ajuste automatico artificial.

### 14.4 Precos

- acoes/FIIs com fechamento diario real em todos os dias uteis;
- opcoes com origem de preco observada ou estimada documentada;
- 3 PMs calculados apenas ate a data;
- nenhum PM historico usa evento futuro.

### 14.5 Patrimonio

- nao ha dupla contagem de transito;
- curva respeita ancoras mensais depois de validar dados base;
- dias sem dados obrigatorios ficam pendentes;
- PRIO3 buy-and-hold usa cotacoes reais.

## 15. Ordem de implementacao recomendada

### Fase 0 - Limpar estado parcial

Objetivo:

- garantir que a base de trabalho compila antes de mexer.

Passos:

1. Revisar `git diff`.
2. Completar ou descartar alteracoes parciais citadas na secao 0.
3. Rodar `npm run build`.

### Fase 1 - Travas estruturais

Objetivo:

- impedir novos dados sem evento.

Tarefas:

1. Fazer `InventoryLedger.recordMovement` exigir `businessEventId`.
2. Fazer `FinancialLedger.record` exigir `businessEventId`.
3. Garantir que `InvestOperations.recordOperation` sempre cria ou recebe evento.
4. Criar auditoria que falha se houver pernas sem evento.
5. So depois de limpar/backfill de dados antigos, avaliar migration para `business_event_id NOT NULL`.

Nao aplicar `NOT NULL` cegamente se a base ainda tem dados orfaos.

### Fase 2 - Abertura e caixa

Objetivo:

- eliminar duplicidade de abertura.

Tarefas:

1. Definir abertura via ledger/evento como unica fonte.
2. Executar a migracao idempotente da secao 3.1.
3. `financial_accounts.opening_balance = 0` para INVEST depois da migracao.
4. Ajustar calculos de saldo para nao somar abertura duas vezes.
5. Reset deve preservar apenas evento `OPENING:2026-01-01` e suas pernas.

### Fase 3 - Notas, pendencias e LIQ BOLSA

Objetivo:

- ligar ativo e financeiro corretamente.

Tarefas:

1. Uma nota = um `business_event`.
2. `total_net` da nota agregado corretamente.
3. Nota gera ativo e expectativa de liquidacao, nao caixa duplicado.
4. Extrato confirma liquidacao.
5. Implementar o algoritmo exato da secao 6.4 para `LIQ BOLSA`.
6. `LIQ BOLSA` nao casado bloqueia.
7. Remover ajuste automatico de divergencia.

### Fase 4 - Calculo de caixa e patrimonio

Objetivo:

- corrigir dupla contagem.

Tarefas:

1. Separar `settledCash`, `inTransit`, `cashWithTransit`.
2. No patrimonio, usar apenas uma forma.
3. Corrigir `PatrimonyMtmDailyEngine` para nao somar transito duas vezes.
4. Rebuild deve parar em `lastTrustedDate`.

### Fase 5 - Precos e cotacoes

Objetivo:

- tornar PRIO3 e demais acoes obrigatoriamente corretas.

Tarefas:

1. Corrigir busca historica para nunca usar preco atual como passado.
2. Implementar cadeia de fontes para acoes/FIIs.
3. Bloquear dia util sem cotacao de acao.
4. Centralizar motor dos 3 precos em `threePricesEngine.computeThreePricesByUnderlying(eventsAteAsOf)`.
5. Remover `ThreePricesValuation` do fluxo INVEST, mantendo no maximo como compatibilidade deprecated.
6. Opcoes estimadas apenas depois da validacao dos demais blocos.

### Fase 6 - Reimportacao e validacao

Objetivo:

- reconstruir a base confiavel.

Passos:

1. Reset preservando abertura.
2. Limpar patrimonio diario e snapshots.
3. Limpar cotacoes historicas suspeitas.
4. Importar notas/extratos/home broker.
5. Buscar cotacoes obrigatorias.
6. Rodar replay.
7. Rodar auditorias.
8. Validar com as 3 planilhas.

## 16. Arquivos que os agentes devem abrir primeiro

Core de eventos:

- `src/core/business-events/BusinessEventRegistry.ts`
- `src/core/business-events/BusinessEventReconciler.ts`
- `src/modules/invest/InvestOperations.ts`

Ledgers:

- `src/core/inventory/InventoryLedger.ts`
- `src/core/financial/FinancialLedger.ts`
- `src/modules/invest/sync/LedgerEventProjection.ts`

Notas e extratos:

- `src/core/invest/btgBrokerageNoteLedgerTranslator.ts`
- `src/core/invest/reconcile/reconcileNotesIndex.ts`
- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/BtgExtractLineParser.ts`
- `src/core/invest/AutoPendingSettlementSync.ts`
- `src/core/invest/settlementCalendar.ts`

Patrimonio e precos:

- `src/core/invest/PatrimonyMtmDailyEngine.ts`
- `src/core/invest/PatrimonyDailyRecorder.ts`
- `src/core/invest/PatrimonyDailyRebuildService.ts`
- `src/core/invest/reconcile/DailyCloseMaterializeService.ts`
- `src/core/invest/threePricesEngine.ts`
- `src/modules/invest/ThreePricesValuation.ts`

UI/diagnostico:

- `frontend/src/pages/InvestConciliacaoPage.js`
- `src/core/invest/reconcile/ReconciliationDiagnosticsService.ts`
- `src/core/invest/reconcile/ReconciliationAuditService.ts`

## 17. O que nao fazer

- Nao corrigir grafico diretamente.
- Nao gravar ajuste automatico para fechar delta.
- Nao deixar `LIQ BOLSA` virar aporte/retirada.
- Nao usar preco atual como cotacao historica.
- Nao interpolar acao.
- Nao deixar perna sem evento.
- Nao rodar rebuild ate hoje sem fonte confiavel ate hoje.
- Nao confiar em modo homologacao como dado oficial.
- Nao misturar mudanca de UI com mudanca de motor sem validar o motor.

## 18. Criterio final de sucesso

O sistema so estara correto quando for possivel responder, para qualquer dia:

1. Qual era o saldo liquidado?
2. Qual era o saldo em transito?
3. Qual evento explicou cada mudanca de caixa?
4. Qual era a quantidade de cada ativo?
5. Qual evento explicou cada mudanca de ativo?
6. Qual preco foi usado em cada ativo e de qual fonte veio?
7. Como foram calculados os 3 PMs?
8. Qual era o patrimonio total?
9. O patrimonio bate com a ancora mensal quando aplicavel?
10. Se nao bate, qual pendencia explica o delta?

Se qualquer uma dessas respostas faltar, a conciliacao ainda nao esta pronta.
