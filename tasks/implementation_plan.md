# Etapa 1 - INVEST: Catálogo Canônico de Operações e Policy Service

Este plano descreve a implementação da Etapa 1, que visa remover as regras hardcoded do domínio INVEST (baseadas em sets de strings) e movê-las para um catálogo no banco de dados, governado pelo novo `InvestOperationPolicyService`.

## User Review Required

> [!IMPORTANT]
> Por favor, revise as perguntas na seção abaixo, pois elas impactam diretamente em como as migrations e os seeds serão construídos.

## Open Questions

> [!WARNING]
> Tenho algumas dúvidas pontuais sobre o padrão do projeto para garantir que farei exatamente como esperado:
> 
> 1. **Localização das Seeds**: A orientação pede para "Criar seeds SQL para todas as operacoes atuais". Estas seeds devem ser incluídas no próprio arquivo de migration (`43_invest_operation_policy_catalog.sql`) ou devo criar um arquivo separado no diretório `src/database/seeds`?
> 2. **Valores Predominantes para colunas booleanas (`conditional`)**: Na tabela da task, o campo `affects_portfolio` e/ou `affects_financial` para algumas operações (como `opening_balance`, `fee`, `penalty_b3`) estão descritos como `conditional`. Como preciso gravar um valor booleano padrão (`true` ou `false`) na tabela para estas policies:
>    - Para `opening_balance`, devo setar `affects_portfolio = true` e `affects_financial = true` no seed?
>    - Para `securities_lending`, devo setar `affects_portfolio = true` ou `false` no seed?
>    - Para `fee` e `penalty_b3`, devo setar `affects_portfolio = false` predominantemente?
> 3. Em `InvestOperations`, ao traduzir de volta o `conditional` do seed para manter o comportamento atual, poderei manter lógicas com `if (policy.operationCode === 'fee' && ...)` temporariamente para lidar com as exceções que não foram para a policy, certo?

## Proposed Changes

### Database
#### [NEW] `src/database/migrations/43_invest_operation_policy_catalog.sql`
- Criação das tabelas `invest_operation_types`, `invest_operation_policies` e `invest_operation_asset_overrides`.
- Inclusão dos seeds SQL (sujeito à resposta da pergunta 1).

### Core (Data Access)
#### [MODIFY] `src/core/dal/TableRegistry.ts`
- Registro das 3 novas tabelas (`invest_operation_types`, `invest_operation_policies`, `invest_operation_asset_overrides`) como tipo `global` com `softDelete: false`.

### Core (Invest)
#### [NEW] `src/core/invest/InvestOperationPolicyService.ts`
- Implementação das tipagens `InvestCashDirection` e `InvestOperationPolicy`.
- Implementação do service `InvestOperationPolicyService` que fará cache em memória (semelhante ao `ModuleCategories`) e buscará do banco via `CoCeoDataGateway.findWhere`.

#### [NEW] `tests/unit/invest/InvestOperationPolicyService.test.ts`
- Criação da suite de testes para garantir que o service resolve todas as operações listadas no requisito, valida defaults, valida override por `asset_type`, e lança `GatewayError('UNKNOWN_INVEST_OPERATION')` quando não acha a policy.

### Modules (Invest)
#### [MODIFY] `src/modules/invest/InvestOperations.ts`
- Injeção do `InvestOperationPolicyService`.
- Refatoração do método privado `kindOf` para ler do service em vez de mapeamento em switch/lists.
- Remoção dos Sets hardcoded (`PASSIVE_INCOME_OPS`, `PASSIVE_EXPENSE_OPS`, `CAPITAL_OPS`, `OPTION_OPS`, `TRADE_OPS`).
- Utilização das propriedades booleanas/strings (`isPassiveIncome`, `isPassiveExpense`, etc) vindas do policy object para tomar decisões.
- Preservação da lógica transicional (ex: movimento financeiro do `option_exercise` ou ajuste patrimonial de `fee`).

#### [MODIFY] `tests/unit/modules/invest/InvestOperations.*.test.ts`
- Atualização para contemplar o mock/injeção do novo `InvestOperationPolicyService` em vez do comportamento estático/hardcoded anterior, assegurando a paridade.

### Outros Arquivos Afetados
- `src/core/invest/cashExtractDedup.ts`
- `src/core/invest/threePricesEngine.ts`
- `src/core/invest/patrimonyLedgerGates.ts`
- `src/core/invest/LiqBolsaSettlementService.ts`
> [!NOTE]
> Esses arquivos serão verificados. Se a adaptação for complexa, será adicionado um "TODO" mantendo o comportamento funcional como instruído, para não aumentar o escopo desnecessariamente nesta etapa.

## Verification Plan

### Automated Tests
- Executarei `npm test -- --runInBand tests/unit/invest/InvestOperationPolicyService.test.ts`
- Executarei `npm test -- --runInBand tests/unit/modules/invest`
- Executarei `npm run build` para garantir que as tipagens e injeções de dependência não causaram regressões.

### Manual Verification
- Executarei comandos com o `rg` (`rg "PASSIVE_INCOME_OPS|..."`) para garantir que os sets hardcoded não existam mais em `InvestOperations.ts`.
- Documentarei na listagem do handoff caso o `rg` encontre restos em outros arquivos (junto com a justificativa instruída).
