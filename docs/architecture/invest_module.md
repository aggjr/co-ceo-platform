# CO-CEO | Módulo INVEST (Wealth Management & Options)

O módulo INVEST não é uma plataforma de trade ou análise gráfica (para isso o usuário já possui os softwares da corretora). Ele é uma **Máquina de Apoio à Decisão Matemática** e um **Controlador de Custódia/Rentabilidade** para operações de Holding e Family Office.

O foco principal inicial é a metodologia de **Vendas Cobertas de Opções (Covered Calls)**.

---

## 1. O Motor de Análise (Quant Engine) e Ingestão de Dados

A alimentação de dados utilizará uma arquitetura de **Web Scraping de Alta Precisão (EOD)** com uma estratégia de descoberta de horário (Polling):

1. **O Robô Noturno (Polling Strategy):** 
   - A partir das `19:01`, o Node.js aciona a rotina de busca de dados no *opcoes.net.br* para o radar de opções (máximo de 20 opções).
   - Se o site ainda não tiver publicado o fechamento do dia, o robô entra em "Dormência" e tenta novamente a cada 5 minutos (`19:06`, `19:11`, etc).
   - Assim que ele detecta o dado novo, ele atualiza as tabelas de custódia, encerra a rotina da noite, e descobre empiricamente o horário exato da liberação da bolsa.
2. **O Marcador de Confiança (UI):**
   - O Dashboard exibirá um selo visual claro. Ex: `🟢 Sincronizado com B3: 17/05 às 19:16`. Isso garante ao gestor que ele não está tomando decisões com os dados do dia anterior.
3. O Backend calcula instantaneamente as métricas da metodologia:

### Métricas Calculadas em Tempo Real no CSV:
1. **Retorno sobre Notional (Prêmio / Strike):**
   - Retorno bruto de proteção. Ajuda a definir qual strike paga a melhor taxa sobre o capital imobilizado.
2. **Retorno sobre Spot (Prêmio / Preço Atual da Ação):**
   - Retorno imediato caso a opção vire pó.
3. **Taxa de Distorção (Gordura Extrínseca):**
   - Isola o Valor Extrínseco (taxa de tempo e volatilidade) para mostrar se o mercado está precificando aquela opção com um prêmio irracionalmente alto.
4. **Break-even (Ponto de Empate):**
   - Preço de compra da ação menos o prêmio recebido.

O sistema exibe essas métricas em um Grid ordenado (do maior Retorno/Notional para o menor), entregando a resposta matemática pronta para o gestor simplesmente ir na corretora e executar a ordem.

---

## 2. Estrutura de Banco de Dados (INVEST Core)

Para suportar essa operação e a posterior conciliação da Holding (OUs), as tabelas abaixo serão criadas no Schema:

### Tabela: `invest_brokers` (Corretoras e Bancos)
Controla onde o dinheiro da Holding está alocado.
- `id`
- `organization_id` (Ex: Carteira do Pai)
- `name` (Ex: BTG, XP, Genial)
- `account_number`
- `current_balance`

### Tabela: `invest_assets` (Ativos na Carteira / Custódia)
A posição real da holding.
- `id`
- `organization_id`
- `broker_id`
- `ticker` (Ex: VALE3, PETRM400)
- `asset_type` (stock, call_option, put_option, fii, fixed_income)
- `quantity`
- `average_price` (Preço Médio rigorously calculado)

### Tabela: `invest_trades` (Registro de Operações)
Aqui reside a inteligência de custos. Cada execução é registrada.
- `id`
- `organization_id`
- `asset_id`
- `trade_date`
- `operation_type` (buy, sell)
- `quantity`
- `price`
- `brokerage_fee` (Custo de Corretagem)
- `b3_fees` (Emolumentos, Liquidação)
- `irrf` (Dedo-duro retido na fonte)
- `net_value` (Valor Líquido real da operação)

### Tabela: `invest_covered_calls` (Agrupamento Lógico)
Essa é a tabela mais inteligente. Ela amarra a Ação (Ativo) com a Opção Vendida, gerando o relatório do ciclo.
- `id`
- `organization_id`
- `stock_asset_id` (Ação que está dando cobertura)
- `option_asset_id` (A opção vendida)
- `status` (open, exercised, expired_worthless, rolled)
- `yield_achieved` (Rentabilidade final fechada da operação)

---

## 2.1 Fronteira INVEST × CASH (contas, passivo e ativo)

O módulo **CASH** (legado `cash-app`: `contas`, `entradas`, `saidas`, `aportes`, `retiradas`) continua sendo o lugar natural para **contas** e **fluxo de caixa**. No cliente só INVEST, cada “conta” é **conta de investimento** (corretora), não conta bancária operacional — mesmo cadastro, outro `account_kind` / plano de contas.

| Camada | Onde vive | Exemplos |
|--------|-----------|----------|
| **Ganhos passivos** | CASH (`entradas`) + espelho opcional no livro-razão INVEST | Dividendos, JCP, locação, remuneração de saldo |
| **Despesas de conta** | CASH (`saidas`) | Manutenção, multas B3, juros por atraso |
| **Capital** | CASH (`aportes` / `retiradas` / transferências) | TED, saques — validados com **extrato mensal** |
| **Ganho ativo** | INVEST (`invest_ledger_entries` + notas) | Compra/venda ações, FIIs, opções, títulos |

**Pivot INVEST:** colunas de passivo e caixa hoje vêm do ledger; na integração plena, o pivot pode **agregar** `entradas`/`saidas` do CASH por conta de investimento, mantendo notas só para custódia e trades.

**Cliente com CASH + INVEST:** uma visão unificada de “patrimônio líquido” (caixa + custódia) no Cockpit, sem duplicar cadastro de conta.

Classificação técnica das operações: `src/core/invest/flowClassification.ts`.

---

## 3. Próximos Passos de Desenvolvimento
1. Criar a tela do Analisador de Opções no Frontend.
2. Construir o Service NodeJS que conecta na Brapi, aplica a fórmula matemática de Retorno/Notional, e devolve a lista ordenada.
3. Desenvolver o painel de Custódia (O que o Pai verá na tela dele).
