# Validacao da estrutura de ativos

Data: 2026-06-05
Branch: codex-guto

## Conclusao executiva

A arquitetura de ativos ja tem uma base correta: `patrimony_items` e extensoes especializadas, `module_categories` para subcategorias dominadas por modulo, flags de patrimonio/cotacao e `InvestQuoteSyncService` roteando fontes de cotacao por catalogo.

Ainda nao esta 100% limpa. Existem atalhos historicos e regras em codigo que fazem alguns ativos nao seguirem exatamente o mesmo contrato arquitetural. Os pontos abaixo devem ser tratados antes de considerar a estrutura extensivel para novos mercados, novos fornecedores e novos tipos de contrato.

## O que esta correto

- `module_categories` e a fonte canonica para flags como `contributes_to_patrimony`, `requires_market_quote`, `default_quote_source` e `valuation_mode`.
- O fluxo novo de cotacoes ja agrupa ativos por `default_quote_source`, em vez de assumir somente B3.
- Renda fixa esta marcada como ativo que contribui para patrimonio e exige cotacao de mercado.
- O MTM diario ja acumula renda fixa como posicao aberta, com quantidade x cotacao, e usa o total agregado apenas como fallback quando nao existe posicao aberta.
- O fallback legado `unit_price = 1` e `quantity = valor financeiro` e aceitavel apenas quando dados historicos nao trazem quantidade/PU reais.

## Achados criticos

### 1. Regras de liquidacao ainda existem em TypeScript

Arquivo: `src/core/invest/settlementCalendar.ts`

Problema:
- O arquivo mantem `SETTLEMENT_COUNTERPARTIES`, `SETTLEMENT_CONTRACT_TYPES`, `SETTLEMENT_COUNTERPARTY_CONTRACT_TYPES` e `INVESTMENT_SETTLEMENT_RULES` em memoria.
- Isso duplica as migrations `38_invest_settlement_rules.sql` e `39_normalize_settlement_contracts.sql`.
- Essa duplicidade quebra a premissa de contratos configuraveis por fornecedor/mercado/modulo.

Direcao correta:
- Criar um `SettlementRuleRepository` lendo as tabelas de settlement.
- Fazer `cashSettlementDate`, `defersCashSettlement` e `cashSettlementRuleLabel` dependerem do repositorio.
- Manter apenas fallback tecnico minimo para ambiente sem banco em testes, nunca como fonte principal de negocio.

### 2. Tesouro Selic 2031 tinha consolidacao hardcoded na carteira

Arquivos:
- `src/core/invest/portfolioMapper.ts`
- `src/core/invest/tesouroDirectLedger.ts`
- `src/controllers/InvestController.ts`

Problema:
- Existia `TESOURO_SELIC_2031_TICKER = 'TESOURO-SELIC-2031'`.
- `consolidateTesouroPortfolioItems` unia tickers de Tesouro em uma linha sintetica.
- `InvestController` chamava essa consolidacao por padrao.

Risco:
- Um ativo especifico vira regra de codigo.
- Outros titulos publicos, CDBs, bonds americanos ou contratos de fornecedores nao conseguem seguir a mesma estrutura sem novas excecoes.

Status:
- Corrigido nesta auditoria: a carteira canonica nao consolida mais Tesouro por ticker fixo.
- Cada papel permanece como item individual de portfolio.

Direcao correta:
- Se a UI precisar agrupar, fazer por uma tabela/configuracao de agrupamento de portfolio, exemplo `portfolio_grouping_rules`.
- Cada contrato/papel deve permanecer como ativo individual com quantidade, PU/cotacao e valor de mercado.

### 3. Inferencia de tipo e underlying ainda usa mapa fixo por ticker

Arquivos:
- `src/core/invest/assetClassifier.ts`
- `src/core/invest/MyProfitHistoricalParser.ts`
- `src/core/invest/BtgExtractLineParser.ts`
- `src/core/invest/extractLedgerEnrichment.ts`

Problema:
- `UNDERLYING_BY_ROOT` fixa ITUB, BBAS, WEGE, PRIO, PETR, VALE.
- Prefixos de renda fixa sao inferidos por string (`TESOURO-`, `CDB-`, `LFT-`, `TD-`).
- Ticker vazio cai como `stock`.
- O parser MyProfit tambem tinha mapeamento especifico de `SELIC 2031`/`LFT` para tickers fixos.
- O parser BTG e o enriquecimento de caixa assumiam `LFT-20310301` quando nao conseguiam ler o vencimento no texto.

Risco:
- Novos mercados e fornecedores exigem alteracao de codigo.
- Um ticker desconhecido pode ser classificado incorretamente como acao.

Status:
- Corrigido nesta auditoria: o parser MyProfit nao mapeia mais `SELIC 2031`/`LFT` para tickers fixos; agora gera identificador generico pelo nome do papel.
- Corrigido nesta auditoria: o parser BTG nao assume mais `LFT-20310301` quando o vencimento nao esta no texto; o enriquecimento de caixa retorna `null` em vez de inventar contrato.

Direcao correta:
- Transformar inferencia em camada de fallback.
- Fonte primaria deve ser `patrimony_items.subcategory` e extensoes/cadastros de ativo.
- Criar cadastro de aliases/padroes por mercado/fornecedor quando a importacao precisar inferir tipo.

## Achados importantes

### 4. Fonte `tesouro_direto` existe no catalogo, mas nao tem adaptador ativo

Arquivo: `src/core/invest/InvestQuoteSyncService.ts`

Problema:
- `module_categories.default_quote_source = 'tesouro_direto'` para renda fixa.
- `fetchQuotesForSource` trata `brapi`, `opcoes_net` e `yahoo_finance`.
- Para `tesouro_direto`, cai em `fonte de cotacao sem adaptador ativo`.

Impacto:
- Renda fixa exige cotacao, mas a sincronizacao automatica nao consegue buscar PU diario.
- O sistema depende de snapshot/manual para a LFT atual.

Direcao correta:
- Implementar adaptador de cotacao para Tesouro Direto/ANBIMA/fornecedor configurado.
- A fonte deve ser plugavel por `module_quote_sources`, nao por if fixo crescente.

### 5. Portfolio summary/alocacao ainda tem regra parcial por tipo

Arquivo: `src/core/invest/portfolioMapper.ts`

Problema:
- `summarizePortfolio` usa logica especial para `stock/fii` e fallback generico para os demais.

Impacto:
- Renda fixa pode aparecer corretamente na lista, mas analises mais avancadas ainda podem depender de regras especificas por tipo.

Status:
- Corrigido nesta auditoria: `applyAllocationPercents` passou a considerar qualquer ativo nao-caixa.

Direcao correta:
- Usar `contributes_to_patrimony` e `valuation_mode` do catalogo para decidir inclusao.
- UI pode agrupar renda fixa junto de caixa por visualizacao, mas o calculo deve enxergar o ativo individual.

### 6. Nomes de variaveis e DTOs ainda falam em stock para qualquer cotacao

Arquivos:
- `src/core/invest/PatrimonyMtmDailyEngine.ts`
- `src/core/invest/PatrimonyDailyRecorder.ts`
- `src/core/invest/PatrimonyDailyStore.ts`
- `src/controllers/InvestController.ts`

Problema:
- `stockQuotes`, `stocksValue` e `stock_cash_settlement_days` hoje carregam valores que ja podem incluir outras categorias.

Impacto:
- Nao e bug funcional imediato, mas induz novos agentes a manter acoes como caso privilegiado.

Direcao correta:
- Renomear gradualmente para `marketQuotes`, `markedPositionsValue`, `quoteMap` e metadados neutros.

## Pontos aceitaveis como regra de dominio

- Opcoes terem extensao propria (`invest_option_ext`) com strike, vencimento e underlying.
- Tres precos serem calculados especificamente para acoes/FIIs e impactos de opcoes, porque isso e metodologia do modulo INVEST.
- Caixa ser uma classe propria financeira, nao um ativo com cotacao.
- Fallback legado `PU=1` para historico incompleto, desde que fique marcado como dado legado/importado e nunca substitua dado real.

## Prioridade de correcao

1. Remover `INVESTMENT_SETTLEMENT_RULES` do caminho principal e ler regras do banco.
2. Criar adaptador configuravel para `tesouro_direto` ou fonte equivalente de PU diario.
3. Trocar calculos de alocacao/sumario para flags do catalogo.
4. Migrar inferencias por ticker para cadastro/configuracao, mantendo regex apenas como fallback de importacao.
5. Renomear DTOs/variaveis de cotacao para termos neutros.
