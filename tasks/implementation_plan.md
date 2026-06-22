# Plano Canonico para Agentes - Market Data, Valuation e Conciliacao INVEST

Este arquivo e a unica fonte de planejamento operacional dentro de `tasks/`.
Todo agente deve ler este documento antes de alterar codigo relacionado a INVEST,
cotacoes, instrumentos de mercado, patrimonio diario, conciliacao ou refresh de
dados no frontend.

## 1. Objetivo

Construir uma arquitetura generica, expansivel e auditavel para atualizar,
armazenar, precificar e reconciliar todos os dados de mercado e todos os dados
especificos de cada cliente.

O botao de seta circular no canto superior direito deve:

1. Atualizar de forma sincrona todos os dados necessarios ao usuario/cliente
   atual.
2. Atualizar de forma assincrona os demais clientes e dados globais que nao
   bloqueiam a resposta do usuario atual.
3. Garantir que a carteira, a conta corrente e o patrimonio diario fechem com
   as ancoras do home broker sempre que essas ancoras existirem.
4. Permitir evolucao de fontes de dados sem reescrever regras de negocio em
   codigo.

## 2. Regra arquitetural proibitiva

E proibido colocar regra de negocio baseada em comparacao direta de string no
codigo de dominio, controllers, services, engines ou UI.

Exemplos proibidos:

```ts
if (source === 'tesouro_direto') { ... }
if (source === 'tesourodireto') { ... }
if (assetType === 'stock') { ... }
if (ticker.startsWith('LFT-')) { ... } // proibido fora de parser/provider especializado
if (provider === 'brapi') { ... }
```

Excecoes permitidas:

1. Adaptadores especializados podem reconhecer formatos externos dentro do seu
   proprio limite. Exemplo: `TesouroDiretoQuoteProvider` pode parsear tickers
   `LFT-YYYYMMDD` porque essa e a funcao do provider.
2. Seeds, migrations e arquivos de catalogo podem conter codigos canonicos.
3. Testes podem usar strings para montar cenarios.
4. Camadas de roteamento generico podem usar chaves vindas de registry/mapa,
   mas nao podem embutir comportamento por `if source === ...`.

Padrao obrigatorio:

```ts
const provider = marketDataRegistry.resolve(sourceCode);
const quotes = await provider.fetch(request);
```

Nao:

```ts
if (sourceCode === 'brapi') return fetchBrapi(...);
if (sourceCode === 'tesouro_direto') return fetchTesouro(...);
```

## 3. Principio central: ativo -> necessidades -> fontes por precedencia

Cada tipo/subtipo de ativo deve ser configurado por catalogo, nao por codigo.

Para cada tipo de ativo, devemos mapear:

1. Quais dados sao necessarios.
2. Quais fontes podem fornecer cada dado.
3. A ordem de precedencia dessas fontes.
4. Se o dado e global ou especifico de cliente.
5. Se o dado pode ser estimado.
6. Qual metodo de estimativa e aceitavel.
7. Qual tolerancia de conciliacao se aplica.

Exemplo conceitual:

```json
{
  "asset_subcategory": "equity_br",
  "required_data": [
    {
      "field": "daily_close_price",
      "scope": "global",
      "precedence": ["brapi", "statusinvest", "investidor10", "manual"],
      "allow_estimate": false
    }
  ]
}
```

```json
{
  "asset_subcategory": "tesouro_selic",
  "required_data": [
    {
      "field": "daily_unit_price",
      "scope": "global",
      "precedence": ["tesouro_transparente_csv", "manual", "lft_vna_estimator"],
      "allow_estimate": true,
      "estimator": "lft_vna_estimator"
    }
  ]
}
```

```json
{
  "asset_subcategory": "option_br",
  "required_data": [
    {
      "field": "contract_metadata",
      "scope": "global",
      "precedence": ["opcoes_net", "b3", "manual"],
      "allow_estimate": false
    },
    {
      "field": "daily_close_price",
      "scope": "global",
      "precedence": ["opcoes_net", "manual", "option_model_estimator"],
      "allow_estimate": true,
      "estimator": "option_model_estimator"
    }
  ]
}
```

## 4. Separacao obrigatoria: global vs tenant

### 4.0 Regras operacionais inviolaveis

Estas regras valem para qualquer reset, importacao, conciliacao, reparo ou
remapeamento de dados INVEST:

1. Mutacoes de dados devem passar pelo wrapper oficial (`CoCeoDataGateway`) ou
   por servicos de dominio que o utilizem. SQL direto so e aceitavel em servico
   oficial de manutencao quando existir justificativa tecnica, auditoria do
   escopo e recalculo explicito do hodometro.
2. Sempre que a base de uma organizacao for apagada ou remapeada em massa, o
   hodometro (`organization_storage_ledger` / `storage_bytes_used`) deve ser
   zerado ou recalculado no mesmo fluxo. Ao iniciar a reimportacao, os novos
   dados devem voltar a contabilizar normalmente via gateway/storage meter.
3. E proibido usar dados, saldos, datas, tickers, strikes, vencimentos, regras
   de liquidacao, fontes ou heuristicas hardcoded. Dados devem vir dos arquivos
   reais, catalogos globais, configuracoes, migrations/seeds canonicas ou
   parametros explicitos.
4. Dados globais reutilizaveis do modulo INVEST devem ficar fora do tenant:
   cotacoes, instrumentos, metadados de opcoes, strikes, vencimentos, indices e
   regras de fonte/precedencia. Dados de cliente devem ficar no tenant:
   quantidades, compras, vendas, custos, caixa, transito, posicoes e eventos.
5. Toda alteracao financeira ou patrimonial precisa estar ligada a um
   `business_event`. Um evento pode ligar ativo a financeiro, financeiro a
   financeiro ou ativo a ativo, mas nao deve existir perna financeira ou
   patrimonial sem fato gerador rastreavel.
6. Importacoes de historico devem ser validadas mes a mes. O mes seguinte so
   pode ser importado depois que o mes atual bater com extrato, caixa, transito,
   posicoes, patrimonio e diagnosticos.
7. Importacao de extratos e notas deve ser incremental e idempotente. Reenviar
   arquivos do mesmo mes ou um pacote parcial ampliado nao pode duplicar
   lancamentos/eventos ja existentes; o sistema deve reconhecer o que ja foi
   lancado no mesmo dia e inserir apenas fatos novos que alterem caixa,
   transito ou carteira.
8. O fechamento diario do cliente deve materializar o detalhe da carteira:
   valor observado ou estimado de cada acao, FII, opcao, titulo publico,
   CDB/outros ativos, alem de caixa liquidado e caixa em transito. Cada linha
   deve registrar a fonte do preco/estimativa para auditoria.
9. A curva de rentabilidade deve ser derivada desses fechamentos diarios
   auditaveis. Ancoras de corretora servem para validacao ou calibracao
   controlada de itens sem preco observado, nunca para esconder erro de caixa,
   quantidade ou cotacao obrigatoria.
10. Resultado por acao deve atribuir corretamente ganhos e perdas de calls,
    puts, trades, daytrades, exercicios, vencimentos sem exercicio, dividendos,
    JCP, locacao e bonificacoes. Opcoes exercidas ou viradas po devem compor a
    coluna correta do ativo subjacente e do tipo de operacao.

### 4.1 Validacao local do mes 1 (BTG janeiro/2026)

Fonte local: `Downloads/Extrato Mensal 004176105.pdf`, copiado apenas para
analise em `local-import/btg-downloads/Jan_2026.pdf`.

Achados derivados do PDF, sem hardcode:

1. Caixa operacional do extrato de investimento:
   - saldo anterior em 01/01/2026: R$ 58.758,79;
   - saldo final em 31/01/2026: R$ 3.614,36.
2. Sumario patrimonial do demonstrativo:
   - patrimonio liquido em 31/12/2025: R$ 1.204.852,77;
   - patrimonio liquido em 31/01/2026: R$ 1.307.469,31;
   - renda fixa liquida em 31/01/2026: R$ 1.331.511,57;
   - derivativos em 31/01/2026: -R$ 27.656,62.
3. LFT 01/03/2031:
   - posicao final: 73,89 cotas a R$ 18.196,290000;
   - compras de janeiro: 3,00 + 10,00 + 2,89 = 15,89 cotas;
   - abertura inferida: 58,00 cotas. Portanto, a abertura anterior
     `1 x valor_total` e invalida.
4. PRIO3:
   - abertura inferida: 5.400 acoes, vendidas em 16/01/2026;
   - valor liquido da venda: R$ 219.983,99.
5. Opcoes:
   - posicao final em 31/01/2026 contem PRION410, PRION415, PRION44,
     PRION45, PRION460, PRION470, PRIOQ43 e PRIOR407;
   - movimentos de janeiro contem vendas de PRIOM/PRION, vencimentos e
     exercicio de PRIOA407;
   - quando nao houver preco historico exato de abertura, estimar por metodo
     explicito e auditavel, nunca por constante fixa escondida.

Bloqueio antes de aplicar no servidor: o parser de caixa ja fecha os saldos
mensais apos aceitar o formato mensal do BTG, mas a importacao patrimonial nao
pode usar o valor financeiro como quantidade de LFT. O parser/importador mensal
precisa ler os blocos de custodia/movimentacao do demonstrativo para gerar
quantidade e preco unitario corretos.

### 4.2 Dados globais

Dados globais nao pertencem a um cliente especifico. Devem ser gravados sem
`organization_id`.

Exemplos:

- Historico de cotacao de acoes, FIIs, ETFs e BDRs.
- Cadastro de instrumentos negociados em mercado.
- Metadados de opcoes: strike, vencimento, tipo, ativo objeto.
- Historico de PU de Tesouro Direto quando obtido de fonte publica.
- Series de indices de mercado: CDI, IPCA, Selic, PTAX.
- Fontes disponiveis e capacidades de cada fonte.

Tabelas atuais relacionadas:

- `market_quotes_daily`
- `market_instruments`
- `market_index_daily`
- `market_quote_source_mappings`
- `module_categories`
- `invest_options_market`

### 4.3 Dados especificos de cliente

Dados de cliente pertencem a uma organizacao/holding. Devem respeitar isolamento
tenant.

Exemplos:

- Quantidade negociada.
- Valor negociado.
- Corretagem, taxas, IRRF, emolumentos.
- Posicao atual do cliente.
- Preco medio gerencial do cliente.
- Evento de negocio e suas pernas financeiras/patrimoniais.
- Conta corrente, liquidacoes pendentes e saldo.
- Snapshot importado do home broker do cliente.
- Ancoras de patrimonio e rentabilidade do cliente.

Tabelas atuais relacionadas:

- `patrimony_items`
- `patrimony_ledger_entries`
- `financial_ledger_entries`
- `business_events`
- `invest_position_ext`
- `invest_option_ext`
- `portfolio_daily`
- `invest_reconciliation_sessions`
- `invest_reconciliation_day_log`

## 5. Modelo alvo de catalogos

### 5.1 Catalogo de tipos de ativo

O catalogo deve responder:

- Esse ativo contribui para patrimonio?
- Esse ativo precisa de preco de mercado?
- Esse ativo aceita estimativa?
- Esse ativo e negociado em bolsa?
- Esse ativo tem metadata de contrato?
- Esse ativo e global, tenant ou hibrido?
- Qual unidade canonica de quantidade?
- Qual motor de valuation usar?

Nao deve existir logica espalhada por `assetType === ...`.

### 5.2 Catalogo de campos de dados

Campos canonicos:

- `daily_close_price`
- `daily_open_price`
- `daily_min_price`
- `daily_max_price`
- `volume`
- `contract_strike`
- `contract_expiration`
- `contract_option_type`
- `contract_underlying`
- `unit_price`
- `index_factor`
- `fx_rate`
- `client_quantity`
- `client_avg_price`
- `client_trade_value`
- `client_fee`
- `client_tax`
- `broker_anchor_patrimony`
- `broker_anchor_return`

Cada campo deve declarar:

- escopo: `global` ou `tenant`
- obrigatoriedade
- fonte primaria
- fontes fallback
- se permite estimativa
- tolerancia de validacao

### 5.3 Catalogo de fontes

Cada fonte deve declarar capacidades, nao regras hardcoded.

Exemplo:

```json
{
  "source_code": "brapi",
  "adapter": "BrapiMarketDataProvider",
  "enabled": true,
  "capabilities": [
    {
      "asset_scope": ["equity_br", "fii_br", "etf_br", "bdr_br"],
      "fields": ["daily_close_price", "daily_open_price", "volume"],
      "historical": true,
      "realtime": false,
      "priority": 10
    }
  ],
  "rate_limit": {
    "requests_per_minute": 60,
    "batch_size": 20
  }
}
```

## 6. Provider registry obrigatorio

Criar uma camada unica de registry para fontes de dados.

Responsabilidades:

1. Resolver o adaptador por `source_code`.
2. Verificar se a fonte esta habilitada.
3. Saber quais campos a fonte fornece.
4. Aplicar precedencia configurada.
5. Registrar falhas por fonte sem abortar todo o refresh quando houver fallback.
6. Retornar dados normalizados, nunca formatos brutos da fonte.

Interface alvo:

```ts
export type MarketDataRequest = {
  asOfDate: string;
  asset: CanonicalAssetRef;
  fields: CanonicalMarketField[];
  tenant?: TenantRef;
};

export type MarketDataResult = {
  asset: CanonicalAssetRef;
  field: CanonicalMarketField;
  value: number | string | null;
  asOfDate: string;
  sourceCode: string;
  confidence: 'exact' | 'official' | 'external' | 'estimated' | 'manual';
  metadata?: Record<string, unknown>;
};

export interface MarketDataProvider {
  readonly sourceCode: string;
  canHandle(request: MarketDataRequest): Promise<boolean>;
  fetch(request: MarketDataRequest): Promise<MarketDataResult[]>;
}
```

O registry deve ser usado por `InvestQuoteSyncService` e pelos fechamentos
diarios. O nome atual `syncFromBrapi` deve ser tratado como legado e substituido
gradualmente por nome generico, por exemplo `syncMarketDataForOrg`.

## 7. Arquitetura de refresh

### 7.1 Refresh sincrono do usuario atual

Quando o usuario clica no botao circular:

1. Identificar `organizationId` atual.
2. Listar todos os ativos ativos do cliente.
3. Para cada ativo, resolver campos necessarios pelo catalogo.
4. Buscar dados globais faltantes ou vencidos pelas fontes em precedencia.
5. Gravar dados globais nas tabelas globais.
6. Atualizar dados tenant derivados quando necessario.
7. Recalcular posicoes do cliente.
8. Recalcular patrimonio/curva quando a tela exigir.
9. Retornar resposta detalhada para UI.

O usuario atual nao deve esperar refresh de outros clientes.

### 7.2 Refresh assincrono dos demais clientes

Apos responder ou em fire-and-forget controlado:

1. Descobrir tickers/instrumentos usados por outros clientes.
2. Remover itens ja sincronizados no refresh sincrono (`ticker + date + field`).
3. Processar por fila, respeitando rate limit por fonte.
4. Registrar falhas por fonte e por ativo.
5. Nunca bloquear a resposta do usuario atual.

### 7.3 Contrato de resposta do botao

A resposta da API deve ser estruturada:

```json
{
  "success": true,
  "asOf": "2026-06-11",
  "currentOrg": {
    "assetsScanned": 42,
    "globalQuotesUpdated": 31,
    "tenantPositionsUpdated": 28,
    "patrimonyDaysRebuilt": 5
  },
  "byAssetClass": {
    "equity_br": { "updated": 10, "missing": 0, "estimated": 0 },
    "option_br": { "updated": 6, "missing": 1, "estimated": 2 },
    "tesouro_selic": { "updated": 3, "missing": 0, "estimated": 1 },
    "cdb_pos": { "updated": 2, "missing": 0, "estimated": 2 }
  },
  "background": {
    "queued": true,
    "jobId": "market-sync-..."
  },
  "warnings": []
}
```

## 8. Valuation e fechamento diario

O fechamento diario deve respeitar:

```text
patrimonio = caixa + valor_dos_ativos + renda_fixa + liquidacoes_pendentes
```

Quando existirem ancoras do home broker:

1. Patrimonio calculado deve ficar coerente com a ancora de patrimonio.
2. Rentabilidade calculada deve ficar coerente com a ancora de rentabilidade.
3. Divergencias devem virar pendencia auditavel, nao ajuste silencioso.

Cada valor usado no fechamento deve ter origem rastreavel:

- source_code
- provider
- confidence
- as_of_date
- created_at
- metadata

Estimativas sao permitidas, mas precisam ser marcadas como estimativas e
precisam ser conciliadas contra ancoras quando existirem.

### 8.1 Dias Uteis e Feriados

Nao devemos considerar nem sabados, nem domingos e nem feriados nacionais como dias uteis para bolsa. Dessa forma, nao terao dados nestes dias nem no patrimonio e nem em nenhum relatorio.

## 9. Eventos de negocio

Todo evento de negocio deve ter composicao contabil completa:

1. Pelo menos uma perna patrimonial e uma financeira; ou
2. Duas ou mais pernas patrimoniais; ou
3. Duas ou mais pernas financeiras.

Evento com uma unica perna e pendencia de conciliacao.

Nenhum ledger entry deve existir sem `business_event_id`, exceto durante etapa
transitoria de importacao antes da conciliacao. Ao fechar dia, pernas orfas
devem bloquear o fechamento.

## 10. Dados adicionais importantes para atender todas as necessidades

Para a arquitetura atender bem todos os casos, ainda precisamos mapear e/ou
implementar:

1. Calendario de mercado por bolsa/fonte.
2. Politica de staleness: quando um dado esta velho demais para ser usado.
3. Rate limit e backoff por fonte.
4. Cache bruto opcional por fonte para auditoria.
5. Normalizacao de tickers e aliases.
6. Mapeamento entre ticker do cliente, ticker de mercado e identificador da fonte.
7. Qualidade/confidence do dado: oficial, externo, estimado, manual.
8. Versionamento de metodologia de estimativa.
9. Trilhas de auditoria para mudancas manuais.
10. Jobs de indices: CDI, IPCA, Selic, PTAX.
11. Fallback manual com justificativa obrigatoria.
12. Alertas de divergencia entre fonte externa e home broker.
13. Controle de lote de importacao e idempotencia.
14. Testes de paridade com home broker.
15. Dashboard de status por fonte e por cliente.
16. Observabilidade: logs, metricas, erros por provider.
17. Reprocessamento desde uma data afetada por nova cotacao.
18. Bloqueio de fechamento quando dado obrigatorio estiver ausente.
19. Politica para fim de semana e feriado.
20. Politica para ativos vencidos, exercidos, liquidados ou zerados.

## 11. Estado atual conhecido

Ja existe no codigo atual:

1. `InvestQuoteSyncService` roteando por fonte configurada.
2. Provider de Tesouro Direto com CSV publico e fallback estimado para LFT.
3. Upsert de `invest_position_ext` quando a posicao nao tem extensao.
4. Upsert de `market_instruments` para opcoes com strike/vencimento.
5. Validacao de fechamento diario contra componentes e ancora BTG.
6. Reconciliador de eventos exigindo composicao completa.

Ainda precisa evoluir:

1. Remover branching por fonte de dentro de `InvestQuoteSyncService`.
2. Criar registry generico de providers.
3. Configurar precedencia N fontes por tipo/campo.
4. Implementar CDB e renda fixa privada por metodologia catalogada.
5. Deduplicar background global por `instrument + field + date`.
6. Melhorar resposta e UX do botao de refresh.
7. Corrigir testes/mocks desatualizados quando o contrato de provider mudar.

## 12. Plano de fases

### Fase A - Fonte unica de arquitetura e limpeza

Status: em andamento neste arquivo.

Entregas:

- `tasks/implementation_plan.md` como unico arquivo dentro de `tasks`.
- Remocao dos planos antigos e duplicados.
- Regras proibitivas para evitar hardcode.

### Fase B - Provider registry generico

Objetivo:

Substituir branching por fonte por registry plugavel.

Arquivos provaveis:

- `src/core/market/MarketDataProviderRegistry.ts`
- `src/core/market/providers/*`
- `src/core/invest/InvestQuoteSyncService.ts`
- `src/core/module-registry/ModuleCategories.ts`

Entregas:

1. Interface `MarketDataProvider`.
2. Registry por `source_code`.
3. Providers existentes registrados:
   - brapi
   - opcoes_net
   - tesouro_transparente_csv
   - yahoo_finance
   - coingecko
   - manual
   - estimadores
4. `InvestQuoteSyncService` consumindo registry.

Aceite:

- Nenhum `if source === ...` em services de dominio.
- Testes unitarios cobrindo precedencia e fallback.

### Fase C - Catalogo de necessidades por ativo

Objetivo:

Modelar quais dados cada tipo de ativo precisa e em qual ordem buscar.

Entregas:

1. Tabela ou seed de `market_data_requirements`.
2. Tabela ou seed de `market_data_source_precedence`.
3. Resolucao por `asset_subcategory`.
4. Fallback por campo, nao por ativo inteiro.

Aceite:

- Acoes podem comecar por brapi e depois tentar statusinvest/investidor10 sem
  alterar o service.
- Opcoes podem buscar metadata numa fonte e preco em outra.
- Tesouro pode buscar CSV publico e estimar LFT se nao encontrar historico.

### Fase D - Renda fixa privada e indices

Objetivo:

Calcular PU de CDB e outros titulos privados por metodologia catalogada.

Entregas:

1. Confirmar alimentacao de `market_index_daily` para CDI, IPCA, Selic e PTAX.
2. Modelar parametros de contrato em `market_instruments` ou extensao tenant,
   conforme o dado seja global ou especifico do cliente.
3. Providers/estimadores:
   - computed_cdi
   - computed_pre
   - computed_ipca
4. Testes de PU por tipo.

Aceite:

- CDB pos-fixado recalcula por CDI.
- Prefixado recalcula por curva/metodologia definida.
- IPCA+ usa indice + spread quando dados existirem.
- Valores estimados aparecem marcados como `confidence: estimated`.

### Fase E - Refresh sincrono/assincrono completo

Objetivo:

Formalizar o botao de refresh como orquestrador generico.

Entregas:

1. API unica de refresh do cliente atual.
2. Job assincrono para dados globais/demais clientes.
3. Deduplicacao por chave global.
4. Relatorio estruturado para UI.

Aceite:

- Usuario atual recebe dados atualizados antes do background.
- Falha no background nao falha resposta sincrona.
- Resposta mostra atualizados, faltantes, estimados e warnings.

### Fase F - UX e observabilidade

Objetivo:

Mostrar ao usuario o estado real dos dados.

Entregas:

1. Flash message detalhado.
2. Indicador de cotacao velha por linha.
3. Tela ou painel de status por fonte.
4. Logs estruturados por provider.

Aceite:

- Usuario sabe o que foi atualizado.
- Usuario sabe o que foi estimado.
- Usuario sabe o que ficou pendente.

## 13. Waves antigas incorporadas e ordenadas

Esta secao substitui os arquivos antigos `wave-*`, `FILA.md`, `QUEUE.md`,
`queue.json`, handoffs e planos soltos que existiam em `tasks/`. Nada deve ser
recriado em arquivos separados. Se algum agente precisar executar uma dessas
frentes, deve editar esta secao ou referenciar o item correspondente neste
arquivo.

### 13.1 Ordem macro consolidada

1. Fundacao de valuation e preco medio.
2. Fundacao de market data generico e fontes por precedencia.
3. Fundacao de fechamento diario e patrimonio.
4. Fundacao de eventos de negocio e auditoria.
5. Sessao de conciliacao dia a dia.
6. UI de conciliacao.
7. Fase de extrato/caixa.
8. Catalogo de UI/menu/deploy.
9. UX e observabilidade de refresh.

### 13.2 Wave 2 - Engine dos tres precos

Status atual: implementada historicamente, mas deve continuar como invariante
do sistema.

Objetivo:

Substituir qualquer modelo FIFO/LIFO ou calculo fragmentado por uma engine unica
de tres precos:

- PM Estrito
- PM B3
- PM Gerencial

Regras preservadas:

- Nao existe FIFO/LIFO.
- O lote inteiro e recalculado a cada entrada.
- Venda parcial reduz quantidade e custo proporcional, mas nao deve destruir
  premio de opcoes do periodo de forma incorreta.
- Quando a quantidade zera, o estado do lote zera.
- Opcoes devem alocar premio proporcional no exercicio.

Contrato esperado:

```ts
export type ThreePrices = {
  qty: number;
  estrito: number;
  b3: number;
  gerencial: number;
  lotStart: string | null;
};

export function computeThreePricesByUnderlying(
  entries: LedgerEvent[]
): Map<string, ThreePrices>;
```

Casos obrigatorios de regressao:

1. Compra simples.
2. Duas compras com media ponderada.
3. Compra e venda parcial.
4. PUT vendida exercida.
5. CALL comprada exercida.
6. Exercicio parcial com premio remanescente.
7. PUTs vendidas parcialmente exercidas e parcialmente expiradas.
8. CALLs vendidas exercidas como saida.
9. Reset ao zerar lote.
10. Estado de opcoes nao vaza apos reset.

Comandos:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\threePricesEngine.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.3 Wave 3 - Resultado por acao com historico completo

Status atual: implementada historicamente, mas deve permanecer como regra.

Objetivo:

A tela de resultados por acao deve reconstruir estado/custodia desde o inicio
confiavel do periodo, nao apenas desde o filtro visual `from`.

Regra:

- Eventos para reconstruir estado: `periodMin..to`.
- Eventos para colunas de resultado exibido: `from..to`.

Aceite:

- Um filtro curto nao pode fazer a posicao "nascer zerada" se havia historico
  anterior.
- O resultado exibido respeita o periodo filtrado.
- O estado usado para calculo vem do historico completo necessario.

### 13.4 Wave Conciliacao CONC-00 - Rebuild patrimonio diario

Status atual: implementada historicamente, mas agora subordinada ao fechamento
estrito deste plano.

Objetivo:

Invalidar e regravar patrimonio diario a partir do livro corrigido, usando
motor MTM e fontes de mercado/estimativas rastreaveis.

Fluxo:

1. `PatrimonyDailyStore.invalidateFromDate(ctx, from)`.
2. Loop de dias uteis.
3. `PatrimonyDailyRecorder.recordDay`.
4. `ledger.reconcileCustody(ctx)`.
5. Validacao:
   `patrimonio = caixa + ativos + renda_fixa + liquidacoes_pendentes`.
6. Se houver ancora BTG, validar tolerancia contra a ancora.

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\PatrimonyDailyRebuildService.test.ts tests\unit\invest\reconcile\DailyCloseMaterializeService.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.5 Wave Conciliacao CONC-10 - Schema e store da sessao

Status atual: implementada historicamente.

Objetivo:

Persistir sessoes de conciliacao e log dia a dia.

Invariantes:

- `horizon_trusted_through` representa ate qual dia o livro foi fechado.
- `progress_by_day` registra estado por dia.
- `day_log.user_decisions` registra decisao humana auditavel.
- Nada deve fechar dia por decisao implicita.

Aceite:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.6 Wave Conciliacao CONC-11 - Varredura completa de auditoria

Status atual: implementada historicamente, mas deve evoluir junto com novos
providers e novos tipos de ativo.

Objetivo:

`ReconciliationAuditService.run(ctx, opts)` deve encontrar divergencias e
transforma-las em pendencias humanas quando necessario.

Dimensoes minimas:

- Pernas orfas.
- Eventos de negocio incompletos.
- Duplicidade de nota/extrato.
- Divergencia entre nota e ledger.
- Divergencia entre caixa e liquidacao.
- Cotacao obrigatoria ausente.
- Estimativa sem confidence.
- Patrimonio diario incoerente.
- Divergencia contra ancora de home broker.
- Ativos vencidos/exercidos ainda abertos.
- Posicoes negativas nao justificadas.
- Tres precos ausentes quando exigidos.
- Dados globais gravados como tenant.
- Dados tenant gravados como globais.
- Fonte sem provider registrado.
- Fallback esgotado.
- Fechamento tentando avancar com pendencia aberta.

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\reconcile\ReconciliationAuditService.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.7 Wave Conciliacao CONC-12 - Sessao dia a dia e materialize

Status atual: implementada historicamente.

Objetivo:

Operar conciliacao como sessao controlada:

- start
- preview por dia
- pending decisions
- resolve
- close
- materialize through date
- as-of

Proibido:

- `acceptWarnings`
- `forceClose`
- auto-fix silencioso
- fechamento com pendencias

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\reconcile\ReconciliationSessionService.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.8 Wave Conciliacao CONC-13 - UI wizard de conciliacao

Status atual: parte historica do roadmap; manter como backlog se ainda nao
estiver completo.

Objetivo:

Pagina unica de conciliacao com:

- upload/pasta de notas
- sessao
- navegacao por dia
- painel "Pendencias do dia"
- destaque cruzado livro/notas/extrato
- botoes somente de `allowedActions`
- botao fechar dia desabilitado ate `canClose === true`

Proibido:

- aceitar aviso em lote
- ignorar divergencia sem decisao
- mutacao direta fora de `resolve/apply`

### 13.9 Wave Conciliacao CONC-14 - Fase extrato/caixa

Status atual: parte historica do roadmap; manter como backlog se ainda nao
estiver completo.

Objetivo:

Estender a sessao para `phase: cash`, bloqueada ate notas completas.

Regra:

- Extrato so entra apos fechamento integral da fase de notas.
- Mesmo loop de pendencias, decisao humana e fechamento estrito.

Aceite:

- API retorna 403 ao iniciar cash se notas estiverem incompletas.
- Fechamento de caixa respeita as mesmas regras de eventos completos.

### 13.10 Wave Conciliacao CONC-05 - Catalogo UI, menu e deploy

Status atual: parte historica do roadmap.

Objetivo:

Garantir que menus, rotas, recursos de acesso e versao de UI reflitam o fluxo
canonico atual.

Aceite:

```powershell
npm run verify:version-ui
node .\node_modules\typescript\bin\tsc --noEmit
```

### 13.11 Planos antigos de policy catalog e cash policy

Status atual: incorporados como principios arquiteturais, nao como arquivos
separados.

Objetivo preservado:

- Remover regras de operacao hardcoded.
- Governar operacoes INVEST por catalogo/policy service.
- Resolver comportamento por tipo de operacao e tipo de ativo via dados.

Regra:

Assim como fontes de mercado nao podem depender de `source === ...`, operacoes
tambem nao podem depender de listas hardcoded espalhadas como:

```ts
PASSIVE_INCOME_OPS
PASSIVE_EXPENSE_OPS
CAPITAL_OPS
OPTION_OPS
TRADE_OPS
```

Se ainda houver listas desse tipo, devem ser tratadas como debito tecnico e
substituidas por catalogo.

### 13.12 Arquivos antigos removidos

Estes arquivos foram consolidados neste plano e nao devem ser recriados:

- `tasks/AGENTE.md`
- `tasks/FILA.md`
- `tasks/QUEUE.md`
- `tasks/README.md`
- `tasks/_template.md`
- `tasks/queue.json`
- `tasks/implementation_plan_.md`
- `tasks/wave-*`
- handoffs soltos em `tasks/`
- planos soltos de arquitetura em `tasks/`

## 14. Malha de execucao por complexidade, precedencia e paralelizacao

Esta secao transforma o plano em um projeto coordenavel. O objetivo e permitir
que agentes baratos executem tarefas simples em paralelo, agentes intermediarios
executem integracoes controladas e agentes de alto padrao tomem decisoes
arquiteturais ou alterem contratos centrais.

### 14.1 Classes de agentes

#### Classe S - Simples

Use para tarefas de baixa complexidade e baixo risco.

Pode executar:

- testes unitarios pequenos
- ajustes de mocks
- correcao de textos e mensagens
- criacao de testes para comportamento ja definido
- refactors locais sem mudar contrato publico
- documentacao no plano canonico
- adaptacao de chamadas a interfaces ja existentes

Nao pode executar:

- migrations
- mudanca de schema
- mudanca de contrato de API
- criacao de provider novo
- alteracao de regras contabeis
- alteracao de fechamento diario
- alteracao de catalogo sem especificacao pronta

#### Classe M - Media

Use para tarefas de integracao com escopo claro.

Pode executar:

- implementar provider seguindo interface ja aprovada
- integrar uma fonte no registry ja existente
- adicionar testes de fallback/precedencia
- implementar endpoint com contrato definido
- ajustar UI para contrato ja definido
- otimizar background sem mudar semantica

Nao pode executar sem revisao arquitetural:

- criar novo modelo de catalogo
- mudar separacao global/tenant
- alterar regra de conciliacao
- alterar motor de valuation
- redefinir tolerancias de patrimonio

#### Classe A - Arquitetural

Use para tarefas de alto impacto ou incerteza.

Responsabilidades:

- definir contratos canonicos
- definir migrations e modelos de dados
- aprovar precedencias por tipo de ativo
- aprovar politica de estimativa e confidence
- aprovar mudancas em fechamento diario
- decompor tarefas grandes em S/M
- revisar se agentes S/M nao introduziram hardcode

### 14.2 Regra de promocao

Uma tarefa deve ser promovida para agente de classe superior quando:

- exigir nova tabela, coluna ou migration
- exigir novo contrato entre backend e frontend
- encontrar ambiguidade entre global e tenant
- exigir excecao a este plano
- precisar comparar nomes especificos no codigo de dominio
- alterar calculo de patrimonio, caixa, PM, PU ou rentabilidade
- falhar duas vezes nos testes por razao nao trivial

Agente simples deve parar e registrar:

```text
BLOCKED_FOR_ARCHITECTURE
Contexto:
Decisao necessaria:
Arquivos afetados:
Testes quebrando:
Sugestao:
```

### 14.3 Modelo de precedencia de tarefas

Cada atividade deve declarar:

```text
ID:
Classe: S | M | A
Status: pending | in_progress | done | blocked
Precede:
Depende de:
Pode rodar em paralelo com:
Nao pode rodar em paralelo com:
Arquivos provaveis:
Aceite:
```

Regra:

- Atividade sem dependencias e sem conflito de arquivos pode ser paralelizada.
- Duas atividades que tocam o mesmo contrato publico nao devem rodar em paralelo.
- Duas atividades que tocam apenas testes diferentes podem rodar em paralelo.
- Toda atividade M/A deve gerar subtarefas S quando possivel.

### 14.4 Backlog ordenado

#### A-01 - Definir contratos canonicos de market data

Classe: A
Status: pending
Depende de: nenhum
Precede: M-01, M-02, M-03, M-04, S-05
Arquivos provaveis:

- `src/core/market/MarketDataProviderRegistry.ts`
- `src/core/market/types.ts`
- `tasks/implementation_plan.md`

Entregas:

- tipos canonicos `MarketDataRequest`, `MarketDataResult`, `MarketDataProvider`
- lista de `CanonicalMarketField`
- definicao de `confidence`
- regra de erro/fallback

Aceite:

- contrato documentado
- nenhum provider implementado diretamente nesta tarefa

Paralelizacao:

- Pode rodar em paralelo com S-01, S-02, S-03, S-04.
- Nao deve rodar em paralelo com M-01.

#### S-01 - Corrigir mocks do contrato atual de opcoes

Classe: S
Status: pending
Depende de: nenhum
Precede: M-02
Arquivos provaveis:

- `tests/unit/invest/InvestQuoteSyncService.catalogRouting.test.ts`

Entregas:

- mock de `fetchOpcoesNetOptionQuotes` incluindo `strikePrice`, `expirationDate`,
  `optionType`, `underlyingTicker`

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\InvestQuoteSyncService.catalogRouting.test.ts --runInBand
```

Paralelizacao:

- Pode rodar com S-02, S-03, S-04.

#### S-02 - Inventariar hardcodes proibidos

Classe: S
Status: pending
Depende de: nenhum
Precede: A-02, M-01
Arquivos provaveis:

- somente relatorio no resumo final ou secao neste plano

Comandos sugeridos:

```powershell
rg -n "source ===|source !==|assetType ===|asset_type ===|provider ===|tesouro_direto|tesourodireto|brapi|opcoes_net|computed_cdi" src tests
```

Entregas:

- lista classificada:
  - permitido em provider/parser/teste/seed
  - proibido em service/domain/controller/UI
  - duvidoso para revisao A

Aceite:

- nenhum codigo alterado
- relatorio claro para A-02

#### S-03 - Inventariar separacao global vs tenant

Classe: S
Status: pending
Depende de: nenhum
Precede: A-03, M-05
Arquivos provaveis:

- somente relatorio no resumo final ou secao neste plano

Entregas:

- lista de tabelas globais
- lista de tabelas tenant
- pontos de escrita atuais
- possiveis violacoes

Aceite:

- relatorio com arquivos e linhas
- nenhuma mudanca de runtime

#### S-04 - Consolidar testes de Tesouro Direto existentes

Classe: S
Status: pending
Depende de: nenhum
Precede: M-03
Arquivos provaveis:

- `tests/unit/invest/TesouroDiretoQuoteProvider.test.ts`

Entregas:

- garantir testes para CSV publico, fallback LFT e ausencia controlada
- nao mudar provider sem necessidade

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\TesouroDiretoQuoteProvider.test.ts --runInBand
```

#### A-02 - Definir catalogo de precedencia por campo

Classe: A
Status: pending
Depende de: A-01, S-02
Precede: M-01, M-02, M-03, M-04
Arquivos provaveis:

- migration futura de catalogo, se aprovada
- seeds de fontes/capacidades
- `tasks/implementation_plan.md`

Entregas:

- estrutura de dados para tipo de ativo, campo canonico, fontes em ordem,
  estimativa, staleness e confidence minima

Aceite:

- decisao escrita
- subtarefas M/S abertas dentro deste plano

#### M-01 - Criar Provider Registry generico

Classe: M
Status: pending
Depende de: A-01, A-02
Precede: M-02, M-03, M-04, M-05
Arquivos provaveis:

- `src/core/market/MarketDataProviderRegistry.ts`
- `src/core/market/providers/*`
- `tests/unit/core/market/MarketDataProviderRegistry.test.ts`

Entregas:

- registry por `source_code`
- sem branching por string no service consumidor
- providers existentes adaptados por wrapper quando possivel

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\core\market\MarketDataProviderRegistry.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

#### M-02 - Migrar opcoes para registry

Classe: M
Status: pending
Depende de: M-01, S-01
Precede: M-05
Arquivos provaveis:

- `src/core/invest/opcoesNetQuotes.ts`
- `src/core/invest/InvestQuoteSyncService.ts`
- `src/core/market/providers/OpcoesNetMarketDataProvider.ts`

Entregas:

- provider de opcoes registrado
- contract metadata separado de preco diario
- strike/vencimento em `market_instruments`

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\InvestQuoteSyncService.catalogRouting.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

#### M-03 - Migrar Tesouro Direto para registry

Classe: M
Status: pending
Depende de: M-01, S-04
Precede: M-05
Arquivos provaveis:

- `src/core/invest/TesouroDiretoQuoteProvider.ts`
- `src/core/market/providers/TesouroDiretoMarketDataProvider.ts`
- `src/core/invest/InvestQuoteSyncService.ts`

Entregas:

- Tesouro via provider registrado
- CSV publico como fonte configuravel
- fallback LFT como estimador configurado, nao hardcoded no service
- ausencia controlada para titulos sem estimador

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\TesouroDiretoQuoteProvider.test.ts tests\unit\invest\InvestQuoteSyncService.catalogRouting.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

#### A-03 - Definir modelo de renda fixa privada

Classe: A
Status: pending
Depende de: S-03, A-02
Precede: M-04
Arquivos provaveis:

- `tasks/implementation_plan.md`
- possivel migration/modelo de contratos

Entregas:

- onde guardar parametros de CDB/CRI/CRA/debenture
- quais parametros sao globais e quais sao tenant
- metodologia para `computed_cdi`, `computed_pre`, `computed_ipca`
- dependencia de CDI/IPCA/Selic/PTAX em `market_index_daily`

Aceite:

- decisao arquitetural escrita
- exemplos de 3 contratos

#### M-04 - Implementar estimadores de renda fixa privada

Classe: M
Status: pending
Depende de: A-03, M-01
Precede: M-05
Arquivos provaveis:

- `src/core/market/providers/ComputedCdiProvider.ts`
- `src/core/market/providers/ComputedPreProvider.ts`
- `src/core/market/providers/ComputedIpcaProvider.ts`
- testes unitarios novos

Entregas:

- PU computado por metodologia
- `confidence: estimated` ou `computed`
- auditoria de parametros usados

Aceite:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\jest\bin\jest.js --runInBand tests\unit\invest
```

#### M-05 - Refatorar refresh do usuario atual

Classe: M
Status: pending
Depende de: M-02, M-03, M-04
Precede: M-06, S-06
Arquivos provaveis:

- `src/core/invest/InvestQuoteSyncService.ts`
- `src/controllers/InvestController.ts`
- testes de controller/service

Entregas:

- endpoint sincrono do cliente atual usando catalogo/registry
- resposta estruturada por classe de ativo
- warnings, missing, estimated

Aceite:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\InvestQuoteSyncService.catalogRouting.test.ts --runInBand
```

#### M-06 - Deduplicar refresh global em background

Classe: M
Status: pending
Depende de: M-05
Precede: S-06
Arquivos provaveis:

- `src/core/market/StockMarketSyncService.ts`
- `src/controllers/InvestController.ts`

Entregas:

- background pula dados ja sincronizados para `instrument + field + date`
- respeita rate limit por provider
- falhas do background nao quebram resposta sincrona

Aceite:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
```

#### S-05 - Testes de ausencia de hardcode em services

Classe: S
Status: pending
Depende de: M-01
Precede: nenhum
Arquivos provaveis:

- teste unitario ou script de lint local

Entregas:

- teste que falha se `InvestQuoteSyncService` voltar a ter branching por fonte

Aceite:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\InvestQuoteSyncService.noHardcode.test.ts --runInBand
```

#### S-06 - Melhorar UX do botao de refresh

Classe: S
Status: pending
Depende de: M-05
Precede: nenhum
Arquivos provaveis:

- `frontend/src/components/layout/MarketQuotesSyncButton.tsx`

Entregas:

- flash message com atualizados, faltantes e estimados
- timestamp da ultima atualizacao
- sem regra de fonte hardcoded no frontend

Aceite:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
```

### 14.5 Lotes paralelizaveis

#### Lote P0 - Pode comecar imediatamente

- S-01
- S-02
- S-03
- S-04
- A-01

S-01/S-02/S-03/S-04 podem ir para agentes simples em paralelo. A-01 deve ir
para agente arquitetural.

#### Lote P1 - Apos A-01 e A-02

- M-01
- A-03

#### Lote P2 - Apos M-01

- M-02
- M-03
- S-05

M-02 e M-03 podem rodar em paralelo se nao editarem o mesmo trecho de
`InvestQuoteSyncService`. Se ambos precisarem tocar o mesmo arquivo, criar uma
subtarefa A para sequenciar a edicao.

#### Lote P3 - Apos A-03 e M-01

- M-04

#### Lote P4 - Apos M-02/M-03/M-04

- M-05

#### Lote P5 - Apos M-05

- M-06
- S-06

### 14.6 Matriz resumida

| ID | Classe | Depende de | Pode paralelizar com | Entrega |
|---|---|---|---|---|
| A-01 | A | - | S-01,S-02,S-03,S-04 | contratos canonicos |
| S-01 | S | - | A-01,S-02,S-03,S-04 | mock opcoes atualizado |
| S-02 | S | - | A-01,S-01,S-03,S-04 | inventario hardcodes |
| S-03 | S | - | A-01,S-01,S-02,S-04 | inventario global/tenant |
| S-04 | S | - | A-01,S-01,S-02,S-03 | testes Tesouro |
| A-02 | A | A-01,S-02 | A-03 | catalogo precedencia |
| M-01 | M | A-01,A-02 | A-03 | provider registry |
| A-03 | A | S-03,A-02 | M-01 | modelo renda fixa privada |
| M-02 | M | M-01,S-01 | M-03,S-05 | opcoes no registry |
| M-03 | M | M-01,S-04 | M-02,S-05 | Tesouro no registry |
| M-04 | M | A-03,M-01 | S-05 | estimadores renda fixa |
| S-05 | S | M-01 | M-02,M-03,M-04 | teste anti-hardcode |
| M-05 | M | M-02,M-03,M-04 | - | refresh sincrono atual |
| M-06 | M | M-05 | S-06 | background deduplicado |
| S-06 | S | M-05 | M-06 | UX do botao |

### 14.7 Regra de claim para agentes

Como existe somente um arquivo em `tasks`, agentes devem declarar no resumo do
trabalho:

```text
Claim: S-02
Base commit:
Arquivos tocados:
Dependencias respeitadas:
Testes rodados:
Status: done | blocked
```

Nao criar novo arquivo de task para claim.

## 15. Comandos de verificacao obrigatorios

Antes de commit:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\jest\bin\jest.js --runInBand
```

Quando alterar market data:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\InvestQuoteSyncService.catalogRouting.test.ts tests\unit\invest\TesouroDiretoQuoteProvider.test.ts --runInBand
```

Quando alterar conciliacao/fechamento:

```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\core\business-events\BusinessEventReconciler.test.ts tests\unit\invest\reconcile\DailyCloseMaterializeService.test.ts tests\unit\invest\PatrimonyDailyRecorder.test.ts --runInBand
```

## 16. Checklist para qualquer agente

Antes de implementar:

- Li este arquivo inteiro.
- Identifiquei se o dado e global ou tenant.
- Identifiquei o campo canonico que estou atualizando.
- Identifiquei a fonte pelo catalogo/registry.
- Nao adicionei branching por string hardcoded.
- Defini fallback e comportamento de ausencia.
- Defini se estimativa e permitida.
- Defini como auditar origem e confidence.

Antes de concluir:

- Atualizei testes.
- Rodei TypeScript.
- Rodei testes relevantes.
- Verifiquei que fechamento diario nao fica incoerente.
- Verifiquei que dados globais nao receberam `organization_id`.
- Verifiquei que dados tenant respeitam `organization_id`.
- Documentei pendencias reais no resumo final.

## 17. Decisoes finais

1. `tasks/implementation_plan.md` e o unico arquivo de planejamento em `tasks`.
2. Novos planos devem ser adicionados como secoes neste arquivo, nao como novos
   arquivos em `tasks`.
3. Regras por fonte, ativo ou provider devem viver em catalogo/registry.
4. Services devem orquestrar capacidades, nao conhecer nomes especificos de
   fontes.
5. Toda estimativa precisa ser auditavel e conciliavel contra ancoras.
6. O refresh do usuario atual tem prioridade absoluta sobre background.

## 18. Carga inicial vs. fechamento diario (patrimonio)

Doc detalhado: `docs/architecture/invest_carga_inicial_vs_diario.md`.

Decisao aplicada:

- Estimativa por ancoras mensais do home broker e **exclusiva da carga inicial**
  (`PatrimonyDailyRecorder.recordDay(ctx, date, { initialLoad: true })`).
- Job diario e qualquer recalculo recorrente rodam em **modo economico**
  (default): so dado real de mercado; opcao sem cotacao usa Black-Scholes/
  decaimento, nunca o "plug" de ancora.
- Prioridade de valoracao: cotacao real do dia > ultimo mercado conhecido >
  Black-Scholes (opcao) > custo; ancora so na carga inicial, como passo final.
- Ancoras vem do banco (`invest_patrimony_monthly_anchors`); sem fallback
  hardcoded no caminho de carga (`build-patrimony-daily-2026.ts` aborta sem seed).

### 18.1 Backlog desta frente (a confirmar com o arquiteto)

- **U-01** Unificar `invest_portfolio_daily` + `invest_position_daily` numa
  estrutura unica com valores individuais, quantidades, totais por ativo e total
  geral (auditoria + desenho do patrimonio diario). Hoje sao duas tabelas com
  reconciliacao cruzada.
- **U-02** Translator de upload dos JSON do home broker -> seed de
  `invest_patrimony_monthly_anchors` + cotacoes/posicoes.
  - **Feito:** fechamentos mensais (`{ mes, patrimonio_inicial/final }`) ja viram
    ancoras via `normalizePatrimonyAnchorInput`; carteira atualizada
    (`patrimonio` + `acoes`/`opcoes`) agora e traduzida para o schema canonico de
    custodia por `homeBrokerPortfolioTranslator.ts`, ligada no
    `HomeBrokerSnapshotUploadService` (3o formato aceito) ->
    `applyBrokerHoldingSnapshot` (cotacoes, `patrimony_items`, ancora do dia + RF).
  - **Pendente:** (a) aposentar `btgPatrimonyAnchorReference.ts` (ancoras hardcoded
    para `org-holding-001`) depois que o seed por upload virar o caminho padrao;
    (b) movimentacao transacional (livro) continua vindo das notas de corretagem
    (`btgBrokerageNoteLedgerTranslator`) — o snapshot de carteira semeia
    posicao/cotacao/ancora, nao transacoes.
- **U-03** Job diario com horario alvo ~19h parametrizado (envs
  `INVEST_CRON_*_AT`) e ordem de prioridade de fontes por ativo (ligado a M-01).

### 18.2 Diferenca de caixa desconhecida (evento de negocio)

Decisao do arquiteto: diferencas de caixa sem explicacao viram eventos de negocio
filtraveis para questionar a corretora. Modelado no nivel `operation_code` (como
todo o resto: dividend, cash_yield, fee, cost_adjustment sao operation_codes
distintos sob o kind `cash_movement`). Dois tipos:

- `extract_divergence` (ja existia) — linha REAL do extrato sem classificacao.
  Gerada pelo `BtgExtractLineParser` (fallback) e agora filtravel.
- `cash_balance_gap` (migration 51) — RESIDUO entre saldo do sistema e saldo da
  corretora sem lancamento correspondente. Evento explicito (substitui o plug
  silencioso desativado). `cash_direction='signed'`, `is_external_flow_for_twr=FALSE`.

Filtro: `GET /api/invest/cash/extract?type=extract_divergence,cash_balance_gap`
(cada linha expoe `operationCode` + `isUnknownDifference`). Migration 51 e
idempotente e aplicada no boot via `ensureCashBalanceGapOperation`.

Pendente (fase 2, depois da carga em producao): gerar `cash_balance_gap`
automaticamente a partir do residuo de reconciliacao (`ReconciliationDiagnosticsService`),
quando houver diferenca confirmada contra o snapshot da corretora.

### 18.3 Carga inicial via API (gráfico aderente)

`POST /api/invest/patrimony-daily/rebuild` agora aceita `initialLoad: true` no
corpo — habilita a calibracao por ancoras na reconstrucao (dias passados de opcao
sem cotacao). Option C e demais recalculos seguem economicos por padrao. Fluxo de
carga inicial por API: upload dos JSON (Option C) seeda ancoras + aplica snapshot;
depois `rebuild { initialLoad: true, from, to }` para o grafico bater com a corretora.

## 19. Invariantes financeiro <-> carteira (auditoria arquitetural 2026-06)

Esta secao registra invariantes inegociaveis e debitos confirmados por auditoria
de codigo. Toda alteracao em livro, conciliacao, fechamento diario ou pivot deve
preservar estes invariantes. Os itens com `Status: aberto` sao gaps reais a
fechar; nao podem ser tratados como "ja funciona".

### 19.1 Partida dobrada por evento (conservacao economica)

Regra: o sistema NAO pode se contentar em validar apenas
`SUM(pernas financeiras) == business_events.total_net`. Todo evento de negocio
precisa fechar como partida dobrada economica:

```text
delta_patrimonial_economico(evento)
  + movimento_financeiro_liquidado(evento)
  + variacao_caixa_em_transito(evento)
  = 0   (ou = variacao de patrimonio liquido rastreada, p/ provento/MTM)
```

- `delta_patrimonial_economico` = soma de `total_value` das pernas patrimoniais
  com sinal por `movement_type` (acquisition negativo de caixa, disposition
  positivo, etc.).
- Eventos puramente patrimoniais (`split`, `bonus`, `revaluation`) e puramente
  financeiros (`dividend`, `jcp`, `cash_yield`, `fee`, `cost_adjustment`) sao
  excecoes declaradas — mas a excecao tem que ser explicita no catalogo de
  composicao, nunca silenciosa.

Estado atual (confirmado): `BusinessEventReconciler` so checa soma financeira vs
header e composicao de pernas; nao existe checagem de zero-sum cruzado
patrimonio<->caixa. `assertConsistent()` existe mas NAO e chamado na importacao
(so no batch de auditoria). Arquivos:
`src/core/business-events/BusinessEventReconciler.ts`,
`src/core/invest/reconcile/ReconciliationAuditService.ts`.

**Contrato formal (EV-A01) — sinais por `movement_type` patrimonial:**

| movement_type | Sinal economico (`total_value`) |
|---|---|
| `acquisition`, `transfer_in`, `short_close` | + (entrada de ativo) |
| `disposition`, `transfer_out`, `short_open` | − (saida de ativo) |
| `split`, `bonus`, `revaluation`, `write_off`, `income_in_kind`, `opening_balance` | 0 (nao move caixa no evento) |

**Sinal financeiro:** `direction=in` → +`amount`; `direction=out` → −`amount`.
Pernas `cancelled` ficam fora da soma.

**Excecoes explicitas (nao exigem zero-sum patrimonio+caixa):**

| Categoria | `event_kind` | Condicao |
|---|---|---|
| Financeiro puro | `cash_movement`, `cash_yield_event`, `broker_note_loan`, `unknown_invest_event` | sem pernas patrimoniais |
| Patrimonial puro | `corporate_action`, `opening_balance` | sem pernas financeiras |
| Provento / MTM | dividendos, `revaluation` | rastreados separadamente (fluxo externo TWR) |

**Regra mista (trade):** `SUM(patrimonio assinado) + SUM(financeiro assinado) ≈ 0` (tolerancia R$ 0,01).

Status: implementado (EV-M01).

Aceite:
- nova dimensao de auditoria "conservacao economica por evento" em
  `ReconciliationAuditService`;
- `assertConsistent()` (ou equivalente) obrigatorio no fechamento de dia,
  bloqueando dia com evento que nao fecha;
- teste de regressao por categoria (financeiro puro, patrimonial puro, misto).

### 19.2 Diferenca de caixa desconhecida e lancamento, nunca tolerancia

Regra: diferenca entre saldo do sistema e saldo da corretora SEM lancamento
correspondente deve virar evento `cash_balance_gap` (kind `cash_movement`,
`unknown_invest_event`), visivel e filtravel, para o usuario investigar. E
proibido absorver a diferenca em tolerancia, arredondamento, ancora ou ajuste
silencioso.

Estado atual (confirmado):
- `cash_balance_gap` existe no catalogo/migration 51 mas NAO ha codigo de runtime
  que o gere; a divergencia hoje aparece so como `status: 'error'` em
  `ReconciliationDiagnosticsService.buildCashRows` (diagnostico, nao pendencia no
  livro). Ver `tasks/implementation_plan.md` 18.2 (fase 2 pendente).
- `MONTH_IMPORT_CASH_TOLERANCE = 20` (`src/core/invest/btgExtractBatchReconcile.ts:10`)
  permite ate R$ 20 de diferenca de abertura/fechamento no `financialOk` do mes.
  Tolerancia e criterio de CASAMENTO, nao licenca para descartar diferenca: todo
  residuo que nao concilia, mesmo dentro da tolerancia, deve gerar
  `cash_balance_gap` visivel.
- Plugs silenciosos legados (`injectCashAdjustment`, `AJUSTE DE DIVERGENCIA`)
  estao desativados — manter desativados.

Status: aberto (geracao automatica de `cash_balance_gap`).

Aceite:
- residuo confirmado contra snapshot da corretora gera `cash_balance_gap`
  automaticamente (a partir de `ReconciliationDiagnosticsService`);
- nenhuma diferenca de caixa fica apenas em diagnostico;
- tolerancia de mes documentada e, se mantida, acompanhada de pendencia para o
  residuo.

### 19.3 Calibracao por ancora nao pode mascarar erro de base

Regra: a calibracao por ancora do home broker so pode ajustar o item que
legitimamente nao tem preco observado (opcao sem cotacao, RF estimada). E
proibido empurrar erro de caixa, quantidade ou cotacao obrigatoria para dentro
do residuo de opcoes para "bater" o patrimonio com a ancora.

Estado atual (confirmado): em modo `calibrate`/`initialLoad`,
`PatrimonyMtmDailyEngine` (`src/core/invest/PatrimonyMtmDailyEngine.ts:546` e
`:554`) calcula `residual = target - base - pending - optionsFromMarket` e joga
tudo em `optionsValue`; se ainda nao bate, sobrescreve
`optionsValue = target - base - pending`. Qualquer erro em `base` (caixa, acoes,
RF) fica escondido no valor das opcoes. `assertPatrimonyCoherent` valida total vs
ancora, nao a corretude por componente.

Status: aberto.

Aceite:
- antes de calibrar, `base` (caixa + acoes B3 obrigatorias + RF com PU) deve
  conciliar independentemente; so o gap de opcoes/RF estimavel entra no residuo;
- residuo plugado marcado com confidence/price_source proprio (ex.
  `anchor_residual`) e limitado a opcoes/itens estimaveis;
- divergencia de base vira pendencia auditavel, nao plug.

### 19.4 Calendario de mercado unico (fechamento, nao so liquidacao)

Regra: dias sem pregao (sabado, domingo e feriado nacional/B3) nao geram ponto de
patrimonio nem linha de relatorio (ver 8.1). O calendario deve ser fonte unica e
catalogada, aplicada tanto a liquidacao (D+N) quanto ao fechamento diario e ao
audit de gaps.

Estado atual (confirmado): feriados B3 existem so para liquidacao
(`src/core/invest/settlementCalendar.ts`, com feriados e regras D+N HARDCODED no
codigo). O fechamento/rebuild de patrimonio e o audit de gaps pulam apenas
sabado/domingo, NAO feriados (`PatrimonyDailyRecorder`, `PatrimonyDailyRebuildService`,
`ReconciliationAuditService.checkPortfolioDailyGaps`). Resultado: fechamentos
fantasma e falsos gaps em feriados.

Status: aberto.

Aceite:
- calendario de feriados vindo de catalogo/DB (nao hardcoded);
- fechamento diario, rebuild e audit de gaps usam o mesmo calendario;
- nenhum ponto de patrimonio em feriado.

### 19.5 Resultado por ativo deve atribuir 100% do ganho/perda

Regra (reforca 4.0.10): a pivot de resultado por ativo
(`StockUnderlyingPivotEngine`, tela `Resultados por acao`) deve cobrir todos os
ganhos e perdas de cada acao/RF, sem buraco silencioso. O total tem que conciliar
com um resultado economico independente (realizado + nao realizado).

Gaps confirmados (`src/core/invest/StockUnderlyingPivotEngine.ts`):
1. Opcao COMPRADA (long) que vira po sem trade de fechamento nao gera perda
   (abertura long e so capital, `:327`); o vencimento a zero nao e lancado.
2. `applyCustody` (`:168`) trata `bonus` como compra mas NAO trata `split` —
   quantidade/custo medio nao sao ajustados, distorcendo P&L de trades pos-split.
3. `amortization` cai no default e so entra se `net != 0`.
4. MTM nao realizado fica fora de `ganho_aproximado` (so exibido em
   `preco_estrito`/`cotacao_atual`) — aceitavel como coluna informativa, mas deve
   ser coluna explicita, nao buraco.
5. Mapa underlying `UNDERLYING_BY_ROOT` (`src/core/invest/assetClassifier.ts:1`)
   tem 6 tickers HARDCODED (viola secao 2/4.0.3); fora deles usa heuristica
   `XXXX3`. O underlying canonico deve vir de catalogo/`invest_position_ext`,
   com o mapa hardcoded so como ultimo fallback marcado como debito.
6. `PnLPivotEngine` (segunda pivot) nao usa `inferUnderlyingTicker` e pode
   orfanar opcao na linha do proprio ticker da opcao.

Status: aberto.

Aceite:
- vencimento de opcao long sem exercicio lanca a perda do premio;
- `split` ajusta custodia na pivot (mesma logica de `CustodyEngine`);
- `amortization` mapeada explicitamente;
- teste de conservacao: soma das linhas da pivot == resultado economico
  independente (realizado + nao realizado) por periodo;
- underlying resolvido por catalogo; mapa hardcoded marcado como fallback/debito.

### 19.6 Evento de tipo desconhecido sempre vira pendencia

Regra (reforca 9): linha de extrato/nota nao classificada gera
`extract_divergence` -> `unknown_invest_event` (ja implementado em
`BtgExtractLineParser` fallback `:593` e `inferBusinessEventKind:24`), visivel via
`GET /api/invest/cash/extract?type=extract_divergence` com `isUnknownDifference`.
E proibido cair em caminho que vira `fee`/`cash` generico sem decisao do usuario.

Revisar (confirmado como risco): custody fee sem casamento caindo em `fee`
(`BtgExtractLineParser` rateio), e `keepUnmatchedLiqBolsaAsCash` mantendo LIQ sem
casamento como caixa em vez de evento desconhecido. Toda classificacao "por
descarte" deve preferir `extract_divergence` a um tipo plausivel inventado.

Status: parcialmente implementado; revisar caminhos de descarte.

## 20. Execucao com validacao independente (gate anti-marra)

Motivacao: a exigencia aqui e de qualidade contabil e precisao de estoque, nao
de "tela que abre". Agentes tendem a alargar tolerancia, plugar diferenca,
enfraquecer teste ou hardcodar dado para fechar a task. Por isso, TODA tarefa
desta secao tem dois papeis obrigatorios e separados: **executor** e
**validador**. A task so e `done` quando o validador aprova com evidencia
propria. Sem validador aprovando, nao integra em `main`.

### 20.1 Papel do validador (independente do executor)

O validador NAO e o mesmo agente/sessao/branch que executou. Ele desconfia do
resumo do executor por principio e reproduz tudo do zero. Funcoes:

1. Rodar o criterio de aceite a partir de checkout limpo do trabalho do executor.
2. Provar que o teste de aceite era VERMELHO antes do fix e VERDE depois
   (red->green real). Teste que ja passava sem o fix nao prova nada.
3. Construir uma checagem INDEPENDENTE do invariante (script/query proprio), nao
   apenas reler o teste do executor. Ex.: somar pernas no banco e conferir
   conservacao, em vez de confiar no assert do PR.
4. Caçar atalho: aceite enfraquecido, tolerancia alargada, plug/ajuste
   silencioso, dado/regra/ticker/feriado/strike hardcoded, escopo expandido,
   `--no-verify`, mock que esconde o caminho real.
5. Conferir que dado global nao recebeu `organization_id` e vice-versa.
6. Conferir que nenhum dado de runtime entrou no repo (regra
   `no-runtime-data-files`).

Saida do validador (registrar no resumo):

```text
Validacao: <ID>
Veredito: APROVADO | REPROVADO
Aceite reproduzido (comando + saida):
Red->green comprovado: sim/nao (como)
Checagem independente do invariante:
Hardcode/tolerancia/plug: nenhum | <onde>
Escopo respeitado: sim/nao
Pendencias:
```

`REPROVADO` volta para o executor; o trabalho NAO entra em `main`. Reprovacao
nao e negociavel por "esta quase".

### 20.2 Criterios de reprovacao automatica (qualquer um reprova)

- Tolerancia numerica alargada para o teste passar (ex.: subir
  `MONTH_IMPORT_CASH_TOLERANCE`, `0.02`, `0.05`, `> 1`).
- Diferenca de caixa/quantidade/patrimonio absorvida em plug, residuo, ancora,
  arredondamento ou `outros_ganhos` sem evento explicito.
- String/ticker/strike/data/feriado/saldo hardcoded fora de
  parser/seed/migration/teste.
- Aceite original trocado por um mais fraco.
- Teste novo que nao falha quando o fix e revertido.
- Fechamento de dia/evento passando com perna orfa ou evento que nao concilia.
- Mock/fixture cobrindo o caminho que deveria ser exercido de verdade.

### 20.3 Classe de executor e validador

Vale a tabela de classes da secao 14.1 (S/M/A). Regra adicional desta secao:

- O validador deve ser de classe **>=** a do executor.
- Tarefa que altera regra contabil, fechamento diario, valuation, PM/PU,
  conciliacao ou tolerancia: executor M sob contrato A aprovado; validador **A**.
- Tarefa de teste/inventario/texto: executor S; validador M.
- Mudanca de schema/migration/contrato: executor A; validador A (outro agente).

### 20.4 Backlog derivado da secao 19

Formato por tarefa: `ID | tema | classe executor | classe validador | depende de`.
Cada `Aceite` e o contrato objetivo; cada `Validacao independente` e o que o
revisor deve provar por conta propria.

#### EV-A01 - Contrato de conservacao economica por evento (19.1)

Classe executor: A. Classe validador: A. Depende de: nenhum. Precede: EV-M01.

Entregas: definicao formal de
`delta_patrimonial_economico + movimento_caixa + variacao_transito = 0`, sinais
por `movement_type`, e catalogo explicito das excecoes (financeiro puro,
patrimonial puro, provento, MTM). Sem implementacao.

Aceite: decisao escrita nesta secao com a tabela de sinais e excecoes.

Validacao independente: validador reescreve a formula a partir de 3 eventos reais
(compra de acao, dividendo, split) e confirma que a regra fecha para os tres.

#### EV-M01 - Auditoria de conservacao + bloqueio no fechamento (19.1)

Classe executor: M (sob EV-A01). Classe validador: A. Depende de: EV-A01.

Arquivos provaveis: `src/core/business-events/BusinessEventReconciler.ts`,
`src/core/invest/reconcile/ReconciliationAuditService.ts`,
`src/core/invest/reconcile/DailyCloseMaterializeService.ts`.

Entregas: nova dimensao de auditoria "conservacao economica por evento";
`assertConsistent` (ou equivalente) chamado no fechamento de dia, bloqueando dia
com evento que nao fecha.

Aceite:
```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\core\business-events\BusinessEventReconciler.test.ts tests\unit\invest\reconcile\ReconciliationAuditService.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

Validacao independente: validador injeta um evento propositalmente desbalanceado
num fixture e prova que o fechamento BLOQUEIA; reverte o fix e prova que passava.

#### EV-S01 - Regressao por categoria de evento (19.1)

Classe executor: S. Classe validador: M. Depende de: EV-M01.

Entregas: testes para financeiro puro, patrimonial puro e misto, cada um
fechando a conservacao.

Aceite: testes verdes; cada teste falha se a regra de conservacao for removida.

#### GAP-M01 - Gerar `cash_balance_gap` automatico (19.2)

Classe executor: M. Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/reconcile/ReconciliationDiagnosticsService.ts`,
`src/core/invest/cashInvestLedger.ts`, controller de extrato.

Entregas: residuo confirmado contra snapshot da corretora vira evento
`cash_balance_gap` (`unknown_invest_event`), visivel em
`GET /api/invest/cash/extract?type=cash_balance_gap`.

Aceite: cenario com saldo sistema != saldo corretora gera 1 evento
`cash_balance_gap`; sem residuo, gera zero.

Validacao independente: validador cria um caso com diferenca de R$ 3,00 sem
lancamento e prova que aparece pendencia filtravel; confirma que nada foi plugado
em ancora/ajuste.

#### GAP-S01 - Residuo dentro da tolerancia ainda vira pendencia (19.2)

Classe executor: S. Classe validador: M. Depende de: GAP-M01.

Arquivos provaveis: `src/core/invest/btgExtractBatchReconcile.ts`,
`src/core/invest/btgMonthImportService.ts`.

Entregas: diferenca de abertura/fechamento dentro de `MONTH_IMPORT_CASH_TOLERANCE`
nao e descartada — gera `cash_balance_gap`. Tolerancia segue so como criterio de
casamento, nunca de descarte.

Aceite: mes com diferenca de R$ 10 importa, mas registra pendencia de R$ 10.

Validacao independente: validador confirma que reduzir a tolerancia para 0 nao
muda o saldo final do livro (a diferenca ja virou evento, nao sumiu).

#### CAL-M01 - Calibracao nao mascara erro de base (19.3)

Classe executor: M (sob revisao A). Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/PatrimonyMtmDailyEngine.ts`,
`src/core/invest/PatrimonyDailyRecorder.ts`,
`src/core/invest/reconcile/DailyCloseMaterializeService.ts`.

Entregas: antes de calibrar, `base` (caixa + acoes B3 obrigatorias + RF com PU)
concilia independentemente; so o gap de opcao/RF estimavel entra no residuo, com
`price_source = anchor_residual`. Erro de base vira pendencia, nao plug.

Aceite: dia com erro proposital de caixa NAO e calibrado a zero; gera pendencia.
```powershell
node .\node_modules\jest\bin\jest.js --runTestsByPath tests\unit\invest\PatrimonyMtmDailyEngine.test.ts --runInBand
node .\node_modules\typescript\bin\tsc --noEmit
```

Validacao independente: validador injeta R$ 1.000 de erro em `cash` e prova que o
residuo de opcao NAO absorve; o patrimonio diverge da ancora e isso vira flag.

#### CLD-A01 - Calendario de mercado em catalogo (19.4)

Classe executor: A. Classe validador: A. Depende de: nenhum. Precede: CLD-M01.

Entregas: modelo (migration/seed) de feriados B3 e regras D+N fora do codigo;
hoje estao hardcoded em `settlementCalendar.ts`.

**Leitura canonica:** `MarketCalendarService` consulta `market_holidays` (migration `54_market_calendar.sql`) com fallback para `settlementCalendar.b3HolidaySet`. Usado em fechamento, rebuild e audit de gaps.

Aceite: schema + seed inicial; decisao escrita de onde o calendario e lido.

Validacao independente: validador confere que nenhum feriado novo exige mudar
codigo (so dado).

#### CLD-M01 - Calendario unico no fechamento e audit (19.4)

Classe executor: M. Classe validador: M. Depende de: CLD-A01.

Arquivos provaveis: `src/core/invest/PatrimonyDailyRecorder.ts`,
`src/core/invest/PatrimonyDailyRebuildService.ts`,
`src/core/invest/reconcile/ReconciliationAuditService.ts`,
`src/core/invest/settlementCalendar.ts`.

Entregas: fechamento, rebuild e audit de gaps usam o mesmo calendario; nenhum
ponto de patrimonio em feriado; nenhum falso gap em feriado.

Aceite: rebuild num intervalo com feriado nao cria ponto no feriado; audit nao
acusa gap nesse dia.

Validacao independente: validador escolhe um feriado real do periodo e prova
ausencia de ponto e ausencia de gap.

#### PIV-M01 - Vencimento de opcao long lanca perda (19.5)

Classe executor: M (sob revisao A). Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/StockUnderlyingPivotEngine.ts`.

Entregas: opcao comprada que expira sem exercicio lanca a perda do premio na
coluna correta do subjacente.

Aceite: fixture com CALL long expirada a zero reduz o resultado do subjacente
pelo premio pago.

Validacao independente: validador monta o caso e confere que a perda aparece e
que o total da pivot cai exatamente pelo premio.

#### PIV-M02 - `split` ajusta custodia na pivot (19.5)

Classe executor: M. Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/StockUnderlyingPivotEngine.ts`
(`applyCustody`), alinhar com `src/core/invest/CustodyEngine.ts`.

Entregas: `split` ajusta quantidade/custo medio na pivot (paridade com
`CustodyEngine`).

Aceite: trade apos split mostra P&L correto (sem distorcao de custo medio).

Validacao independente: validador compara a custodia da pivot apos split com a
custodia do `CustodyEngine` para o mesmo ledger; devem bater.

#### PIV-S01 - Mapear `amortization` (19.5)

Classe executor: S. Classe validador: M. Depende de: nenhum.

Entregas: `amortization` mapeada explicitamente (nao via default por `net != 0`).

Aceite: evento de amortizacao cai na coluna definida, nunca silenciosamente.

#### PIV-A01 - Underlying por catalogo, nao hardcode (19.5)

Classe executor: A/M. Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/assetClassifier.ts`,
`src/modules/invest/sync/LedgerEventProjection.ts`, `market_instruments`.

Entregas: underlying da opcao resolvido por catalogo/`invest_position_ext`; o mapa
`UNDERLYING_BY_ROOT` (6 tickers hardcoded) vira so fallback marcado como debito.

Aceite: opcao de ticker fora do mapa resolve o subjacente correto via catalogo.

Validacao independente: validador adiciona uma opcao de papel novo (fora dos 6)
e prova que cai no subjacente certo sem editar codigo.

#### PIV-S02 - Teste de conservacao da pivot (19.5)

Classe executor: S. Classe validador: M. Depende de: PIV-M01, PIV-M02, PIV-S01.

Entregas: teste que soma todas as linhas da pivot e compara com resultado
economico independente (realizado + nao realizado) do periodo.

Aceite: `soma das linhas == resultado independente` dentro de R$ 0,01.

Validacao independente: validador roda o teste com um ledger real de 1 mes e
confere o batimento; remove uma coluna e prova que o teste quebra.

#### UNK-M01 - Caminhos de descarte preferem evento desconhecido (19.6)

Classe executor: M. Classe validador: A. Depende de: nenhum.

Arquivos provaveis: `src/core/invest/BtgExtractLineParser.ts`,
`src/core/invest/btgUploadImportService.ts`.

Entregas: custody fee sem casamento e LIQ sem casamento (`keepUnmatchedLiqBolsaAsCash`)
preferem `extract_divergence`/`unknown_invest_event` a um tipo plausivel inventado.

Aceite: linha ambigua vira pendencia desconhecida, nunca `fee`/`cash` chutado.

Validacao independente: validador injeta uma linha de custody fee sem match e
prova que vira pendencia investigavel, nao `fee`.

### 20.5 Matriz resumida

| ID | Tema (19.x) | Exec | Valid | Depende de |
|---|---|---|---|---|
| EV-A01 | conservacao contrato | A | A | - |
| EV-M01 | conservacao auditoria | M | A | EV-A01 |
| EV-S01 | conservacao testes | S | M | EV-M01 |
| GAP-M01 | cash_balance_gap auto | M | A | - |
| GAP-S01 | tolerancia nao descarta | S | M | GAP-M01 |
| CAL-M01 | calibracao sem mascara | M | A | - |
| CLD-A01 | calendario catalogo | A | A | - |
| CLD-M01 | calendario unico | M | M | CLD-A01 |
| PIV-M01 | opcao long expira | M | A | - |
| PIV-M02 | split na pivot | M | A | - |
| PIV-S01 | amortization | S | M | - |
| PIV-A01 | underlying catalogo | A | A | - |
| PIV-S02 | conservacao pivot | S | M | PIV-M01,M02,S01 |
| UNK-M01 | descarte->desconhecido | M | A | - |

### 20.6 Claim do par executor + validador

Como `tasks` tem so este arquivo, cada agente declara no resumo:

```text
Claim: <ID>
Papel: executor | validador
Par: <branch do outro papel>
Base commit:
Arquivos tocados:
Aceite rodado (comando + resultado):
Status: done (executor) | APROVADO/REPROVADO (validador) | blocked
```

Regras:
- Executor e validador em sessoes/branches diferentes (ver
  `git-two-agents-same-machine.mdc`). Nunca o mesmo agente nos dois papeis.
- Executor abre PR/integra somente apos `APROVADO` do validador.
- Validador que aprovar sem reproduzir o aceite e sem a checagem independente
  esta violando esta secao.
- Lotes paralelizaveis: EV-A01, GAP-M01, CAL-M01, CLD-A01, PIV-M01, PIV-M02,
  PIV-S01, PIV-A01, UNK-M01 nao tem dependencia entre si e podem ser distribuidos;
  cuidar so de nao editar o mesmo arquivo em paralelo (PIV-M01 e PIV-M02 tocam
  `StockUnderlyingPivotEngine.ts` — sequenciar ou coordenar).

