# INVEST - plano atual: carteira, financeiro, 3 precos e curvas

> Autor: codex-guto  
> Status: documento central de orientacao para os proximos ajustes  
> Criado em: 2026-06-02  
> Base analisada: V0.0.257  
> Objetivo imediato: carteira de ativos correta, financeiro correto, 3 precos corretos, curva de patrimonio correta e benchmarks PRIO/CDI corretos.

Este documento deve ser o ponto de partida dos proximos agentes que atuarem no INVEST. Ele evita reler toda a arquitetura do software e foca apenas no objetivo atual.

## 1. Veredito sobre o resultado atual

O resultado gerado pelo fluxo atual da conciliacao deve ser considerado invalido para decisao financeira.

Nao e apenas um erro visual. Ha falhas arquiteturais que podem ter contaminado:

- `market_quotes_daily`, especialmente PRIO3 e outros ativos buscados historicamente via brapi;
- `invest_portfolio_daily`;
- `invest_daily_snapshots`;
- `invest_position_ext.last_price`;
- PMs gravados em `invest_position_ext`;
- curva de patrimonio e benchmarks exibidos em Resultado historico.

Conclusao pratica:

1. Nao usar a curva atual como verdade.
2. Nao rodar nova importacao definitiva antes das correcoes P0-P3 deste documento.
3. Depois das correcoes, refazer a importacao/replay preservando apenas a abertura confiavel de 2026-01-01 e as ancoras mensais que forem validadas.

## 2. Estruturas relevantes para o objetivo atual

O proximo agente nao precisa conhecer todas as areas do sistema. Para este objetivo, as estruturas relevantes sao estas.

### Livro canonico

- `business_events`: fato economico agregador.
- `patrimony_ledger_entries`: pernas patrimoniais, como compra, venda, exercicio, abertura e ajuste de custo.
- `financial_ledger_entries`: pernas financeiras, como caixa, saldo em transicao, taxas, TEDs e liquidacoes.

Regra: qualquer fato que una ativo e financeiro deve compartilhar o mesmo `business_event_id`.

### Carteira atual

- `patrimony_items`: itens patrimoniais e quantidade atual derivada do ledger.
- `invest_position_ext`: extensao INVEST com classe do ativo, PMs, ultimo preco e metadados.
- `invest_option_ext`: dados especificos de opcoes.

Regra: carteira e PMs devem derivar do ledger, nao da tela.

### Precos de mercado e benchmarks

- `market_quotes_daily`: cotacoes historicas de acoes, FIIs, opcoes quando houver fonte, e benchmarks por ticker.
- `market_index_daily`: CDI e indices.

Regra: uma cotacao historica so pode ser gravada na data em que ela realmente ocorreu. Nunca gravar preco atual com data antiga.

### Curva de patrimonio

- `invest_portfolio_daily`: patrimonio diario consolidado.
- `invest_daily_snapshots`: posicoes por ativo no dia.
- `invest_patrimony_monthly_anchors`: totais mensais do home broker, usados como referencia/ancora.

Regra: curva principal deve ser economica e explicavel pelo livro + cotacoes validas. Ancora do home broker pode ajudar, mas nao pode mascarar erro do livro.

## 3. Falhas encontradas na arquitetura atual

### P0. Cotacoes historicas da brapi podem estar erradas

Arquivo:

- `src/core/invest/B3QuoteProvider.ts`

Problema:

Quando `fetchB3Quotes` recebe `asOfDate`, ele pede historico com `range=1mo`. Para datas antigas, como janeiro de 2026 quando estamos em junho de 2026, a API pode nao trazer a barra historica daquela data.

O codigo entao cai em `regularMarketPrice`, que e o preco atual/ultimo, mas mantem `asOf = asOfDate`. Na pratica, pode gravar o preco atual da PRIO3 como se fosse cotacao de 2026-01-xx.

Efeito:

- Curva de PRIO3 fica errada.
- `market_quotes_daily` fica contaminada.
- Patrimonio diario fica errado porque usa essas cotacoes.
- `invest_position_ext.last_price` pode ficar incoerente.

Correcao obrigatoria:

- Se `asOfDate` foi solicitado e nao ha barra historica para a data ou para um criterio permitido, nao usar `regularMarketPrice` como cotacao daquela data.
- Separar claramente duas operacoes:
  - cotacao atual/latest;
  - cotacao historica.
- Historico antigo deve vir de fonte historica confiavel, import de arquivo, backfill especifico ou endpoint com range suficiente.
- Metadado deve registrar se a cotacao e `historical_close`, `previous_close`, `latest_snapshot` ou `manual`.

### P1. Recalculo dos 3 precos ignora `asOfDate`

Arquivo:

- `src/core/invest/reconcile/DailyCloseMaterializeService.ts`

Problema:

`recalcThreePrices(ctx, asOfDate)` recebe a data, mas internamente faz:

```ts
const today = new Date().toISOString().slice(0, 10);
const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', today);
```

Ou seja, ao fechar um dia passado, o calculo usa eventos futuros. Isso contamina PMs historicos e snapshots.

Efeito:

- PM estrito, PM B3 e PM gerencial podem refletir operacoes que ainda nao existiam naquele dia.
- `invest_daily_snapshots` pode ficar historicamente falso.
- Carteira exibida durante o replay pode parecer incoerente.

Correcao obrigatoria:

- Usar `asOfDate` como limite superior.
- `rebuildCustodyFromLedger(events)` deve receber apenas eventos ate `asOfDate`.
- `computeThreePricesByUnderlying(events)` tambem deve receber apenas eventos ate `asOfDate`.
- Cotacao usada em `last_price` durante fechamento historico deve ser cotacao em ou antes de `asOfDate`, nao ultimo preco de hoje.

### P2. Rebuild final vai ate hoje, mesmo com dados importados ate maio

Arquivo:

- `src/core/invest/PatrimonyDailyRebuildService.ts`

Problema:

O rebuild usa `today` como limite padrao. Se a ultima nota/extrato vai ate 2026-05-27, mas hoje e 2026-06-02, o sistema pode gravar dias sem dados fonte confiavel.

Efeito:

- Cauda da curva pode ficar artificial.
- Cotas/benchmarks podem misturar dados reais, estimados e ausentes.
- Resultado historico parece completo, mas nao e.

Correcao obrigatoria:

- Rebuild padrao da conciliacao deve ir ate `horizonTrustedThrough`, `lastSourceDate` ou data explicitamente escolhida.
- Nao usar `today` como padrao em replay historico.
- A resposta deve mostrar claramente:
  - `sourceFrom`;
  - `sourceTo`;
  - `rebuildTo`;
  - `lastTrustedDate`.

### P3. Fluxo processa notas e so depois extratos

Arquivos:

- `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`
- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/reconcile/ReconciliationSessionService.ts`

Problema:

O fluxo atual fecha/materializa dias durante a fase de notas e so depois importa os extratos. Isso gera uma visao incompleta do financeiro durante o replay.

Efeito:

- Patrimonio diario durante a fase de notas pode usar saldo financeiro parcial.
- Saldo atual e saldo em transicao podem nao refletir o extrato real.
- `LIQ BOLSA`, taxas, IRRF, TEDs e rendimentos entram tarde demais.

Correcao obrigatoria:

- O objetivo atual exige caminhar por dia com ativos e financeiro juntos.
- Para cada data:
  - aplicar notas daquele pregao;
  - aplicar extrato/linhas financeiras daquela data;
  - ligar liquidacoes D+n com eventos de negocio;
  - so entao materializar carteira, PMs e patrimonio do dia.

Opcao intermediaria aceitavel:

- Manter notas primeiro, mas nao gravar `invest_portfolio_daily` definitivo ate a fase de extratos terminar.
- Depois importar extratos, reconstruir tudo de `2026-01-01` ate `lastTrustedDate`.

### P4. Modo homologacao avanca mesmo com pendencias

Arquivo:

- `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`

Problema:

Em homologacao, o sistema registra pendencias mas segue o fluxo. Isso e util para destravar testes, mas perigoso se o resultado gerado for tratado como correto.

Efeito:

- Divergencias conhecidas podem entrar em `invest_portfolio_daily`.
- O grafico pode parecer concluido mesmo com erro.

Correcao obrigatoria:

- Separar resultado `debug/homologation` de resultado `trusted`.
- Dias fechados com pendencia nao devem alimentar curva oficial.
- `invest_portfolio_daily` deve ter `source` ou metadata indicando `trusted=false` quando houver pendencias.

### P5. `LIQ BOLSA` ainda tem matching pragmatico

Arquivos:

- `src/core/invest/btgUploadImportService.ts`
- `src/core/invest/AutoPendingSettlementSync.ts`

Problema:

A quebra do `LIQ BOLSA` agregado tenta casar soma por data/sinal/valor com pendencias `AUTO-D2:*`. Isso e melhor que tratar tudo como caixa generico, mas ainda nao e auditoria completa.

Efeito:

- Se houver mais de um conjunto de pendencias com mesmo valor/data, o pareamento pode ficar ambiguo.
- Se taxas forem agregadas junto, a soma pode nao bater.

Correcao recomendada:

- Registrar relacionamento explicito entre linha de extrato e liquidacoes.
- Criar relatorio de `matched`, `partial`, `unmatched`.
- Quando nao bater, nao transformar em verdade silenciosa.

### P6. Home broker mensal ainda nao tem contrato rigoroso

Arquivos:

- `src/core/invest/reconcile/HomeBrokerSnapshotUploadService.ts`
- `src/core/invest/PatrimonyMonthlyAnchorsSeedService.ts`
- `src/core/invest/applyBrokerHoldingSnapshot.ts`

Problema:

Os JSONs de home broker foram tratados como opcionais e alguns logs anteriores indicaram falta de `referenceDate`.

Efeito:

- Ancoras podem nao entrar.
- Opcoes sem cotacao diaria podem ser interpoladas ou estimadas sem rastreabilidade suficiente.

Correcao obrigatoria:

- Definir schema minimo dos JSONs.
- Exigir ou inferir `referenceDate` a partir do nome do arquivo, mas registrar a origem da inferencia.
- Separar claramente:
  - preco observado;
  - preco interpolado;
  - valor residual para bater patrimonio.

## 4. Erro na criacao das estruturas?

Nao ha evidencia de que as tabelas principais tenham sido criadas erradas. As estruturas parecem suficientes para o objetivo atual.

O problema identificado e principalmente de uso das estruturas:

- cotacao historica gravada com valor errado;
- recalc historico usando eventos futuros;
- materializacao antes de ter o financeiro completo;
- rebuild indo alem do horizonte confiavel;
- modo homologacao gerando artefato que parece definitivo.

Portanto, nao comece criando novas tabelas. Primeiro corrija o comportamento dos servicos atuais e so crie estrutura nova se for necessaria para auditoria do `LIQ BOLSA` ou rastreabilidade de estimativas.

## 5. Preciso refazer a importacao?

Sim, mas somente depois das correcoes P0-P3.

Reimportar agora tende a repetir os mesmos erros.

Depois das correcoes, o procedimento recomendado e:

1. Preservar abertura confiavel de 2026-01-01.
2. Apagar dados pos-abertura do INVEST:
   - `business_events` nao-opening;
   - `patrimony_ledger_entries` nao-opening;
   - `financial_ledger_entries` nao-opening;
   - `patrimony_items` sem opening;
   - `invest_position_ext` e `invest_option_ext` ligados aos itens apagados;
   - `invest_portfolio_daily`;
   - `invest_daily_snapshots`.
3. Limpar ou corrigir cotacoes historicas suspeitas:
   - tickers da carteira, especialmente PRIO3;
   - periodo 2026-01-01 ate `lastTrustedDate`;
   - rows `source='brapi'` com metadata `kind='last'` gravadas em data historica antiga devem ser consideradas suspeitas.
4. Recarregar cotacoes historicas confiaveis antes de gravar patrimonio.
5. Rodar replay da conciliacao.
6. Rodar auditorias de consistencia.

Ancoras mensais do home broker podem ser preservadas se os arquivos forem validados e tiverem `referenceDate` confiavel. Caso contrario, limpar e reimportar tambem.

## 6. Ordem de correcao para os proximos agentes

### Etapa 1 - Bloquear nova verdade errada

Objetivo:

- impedir que o sistema continue gravando curvas aparentemente oficiais com cota errada.

Tarefas:

- Ajustar `B3QuoteProvider` para nao gravar `regularMarketPrice` como historico antigo.
- Adicionar log/erro claro quando historico nao estiver disponivel.
- Marcar no retorno da conciliacao que dados atuais estao `untrusted` se houver cotacao faltante.

Aceite:

- Pedir PRIO3 para 2026-01-15 nao pode gravar preco atual com `quote_date=2026-01-15`.

### Etapa 2 - Corrigir fechamento as-of

Objetivo:

- cada dia deve ser calculado apenas com informacoes disponiveis ate aquele dia.

Tarefas:

- Corrigir `DailyCloseMaterializeService.recalcThreePrices`.
- Corrigir uso de `loadLatestQuoteMap` em fechamento historico.
- Garantir que `PatrimonyDailyRecorder.recordDay(date)` nao use ultimo preco atual quando existe `quoteForDate`.

Aceite:

- Fechamento de 2026-02-10 nao pode usar operacoes nem cotacoes posteriores a 2026-02-10.

### Etapa 3 - Corrigir horizonte de rebuild

Objetivo:

- rebuild deve parar na ultima data confiavel, nao em hoje.

Tarefas:

- `PatrimonyDailyRebuildService.rebuild` deve aceitar e respeitar `to`.
- Option C deve chamar rebuild com `to = lastTrustedDate`.
- UI deve exibir `lastTrustedDate`.

Aceite:

- Se ultimo arquivo confiavel e 2026-05-27, nao gravar 2026-05-28 em diante sem fonte.

### Etapa 4 - Reestruturar replay diario financeiro + ativos

Objetivo:

- caminhar dia a dia com os dois lados.

Tarefas:

- Indexar extratos por `transaction_date`.
- No dia D, importar notas e linhas financeiras pertinentes.
- Para liquidacoes D+n, permitir que extrato de D+n case com evento gerado em D.
- Materializar patrimonio somente depois das duas fontes do dia.

Aceite:

- Um dia com nota mas sem extrato necessario deve ficar pendente ou `untrusted`, nao fechado como definitivo.

### Etapa 5 - Reimportacao controlada

Objetivo:

- limpar dados contaminados e reconstruir.

Tarefas:

- Rodar reset preservando opening.
- Limpar cotacoes historicas suspeitas.
- Reimportar fontes.
- Gerar relatorio final de validacao.

Aceite:

- Carteira bate com home broker.
- Financeiro bate com extrato.
- PRIO3 bate com fonte historica externa.
- CDI tem serie consistente.
- 3 PMs de PRIO3 e demais acoes batem com regra definida.
- Patrimonio diario fecha com livro + cotacoes + ancoras justificadas.

## 7. Validacoes obrigatorias antes de considerar concluido

### Carteira de ativos

- Quantidade por ticker em `patrimony_items` igual ao replay do ledger.
- Quantidade por ticker igual ao home broker na data de fechamento mensal, quando houver snapshot.
- Opcoes vendidas/compradas com sinal correto.
- Exercicios baixam opcoes e entram/saem acoes corretamente.

### Financeiro

- Saldo liquidado igual ao extrato na data.
- Saldo em transicao explica D+1/D+2.
- `LIQ BOLSA` casado com eventos de negocio ou listado como pendencia.
- TEDs classificados como aporte/retirada e removidos do TWR.

### 3 precos

- PM estrito derivado apenas das compras/vendas do ativo.
- PM B3 com ajustes fiscais corretos.
- PM gerencial com premios de opcoes conforme regra.
- Nenhum PM de data passada calculado com evento futuro.

### Curvas

- PRIO3 usa cotacao historica real em `market_quotes_daily`.
- CDI usa `market_index_daily`.
- Patrimonio usa `invest_portfolio_daily` somente para dias confiaveis.
- Datas sem cotacao devem aparecer como pendencia ou usar regra explicita de carry-forward, nunca preco atual disfarçado de historico.

## 8. Arquivos que o proximo agente deve abrir primeiro

Para corrigir sem redescobrir tudo:

1. `src/core/invest/B3QuoteProvider.ts`
2. `src/core/invest/InvestQuoteSyncService.ts`
3. `src/core/invest/reconcile/DailyCloseMaterializeService.ts`
4. `src/core/invest/PatrimonyDailyRecorder.ts`
5. `src/core/invest/PatrimonyDailyRebuildService.ts`
6. `src/core/invest/reconcile/OptionCDailyCloseOrchestrator.ts`
7. `src/core/invest/btgUploadImportService.ts`
8. `src/core/invest/AutoPendingSettlementSync.ts`
9. `src/core/invest/threePricesEngine.ts`
10. `src/controllers/InvestController.ts`, apenas a funcao `getPatrimonyDailyImpl`

Nao comece por UI. A UI esta mostrando erro produzido pelo dominio.

## 9. Decisoes de produto para manter

- Abertura confiavel: 2026-01-01.
- Dados ainda sao de homologacao; pode apagar e refazer.
- O objetivo nao e perfeicao auditavel total agora, mas sim resultado correto e explicavel.
- Resultado correto exige os quatro blocos juntos:
  - carteira;
  - financeiro;
  - 3 precos;
  - curvas de patrimonio/PRIO/CDI.
- Nao aceitar grafico bonito se a fonte de cotacao ou o as-of estiver incorreto.

## 10. Frase guia para os proximos agentes

Nao tente consertar o grafico diretamente. Primeiro garanta que cada dia usa apenas ledger e cotacoes validas daquele dia; depois reconstrua carteira, financeiro, PMs e patrimonio a partir dessa base.
