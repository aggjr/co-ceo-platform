# ETAPA 1 - INVEST: catalogo canonico de operacoes e policy service

Status: pronto para implementacao por agente

Objetivo desta etapa: remover do dominio INVEST as regras fixas baseadas em listas, `if`, `Set` e convencoes hardcoded de operacoes. Ao final, a semantica de uma operacao INVEST deve vir de tabelas de catalogo e de um service unico (`InvestOperationPolicyService`), nao de constantes espalhadas em codigo.

Esta etapa NAO deve refatorar broker adapters, caixa, abertura, market data ou patrimonio diario. Ela prepara a base para essas proximas etapas.

---

## 1. Contexto arquitetural

O INVEST ja possui uma fundacao correta:

- `business_events` como header canonico de eventos.
- `InventoryLedger` para pernas patrimoniais.
- `FinancialLedger` para pernas financeiras.
- `module_categories` para categorias de ativos e valuation.
- `SettlementRulesService` para regras de liquidacao.
- `InvestOperations` como orquestrador principal.

O problema desta etapa esta concentrado na semantica de operacoes. Hoje o codigo ainda decide comportamento por listas fixas em arquivos como:

- `src/modules/invest/InvestOperations.ts`
- `src/core/invest/cashExtractDedup.ts`
- `src/core/invest/threePricesEngine.ts`
- `src/core/invest/patrimonyLedgerGates.ts`
- `src/core/invest/LiqBolsaSettlementService.ts`
- outros arquivos que tenham `new Set([...operacoes])`, `op ===`, `operation ===`, `transaction_type ===`

Exemplos de regra que NAO podem continuar hardcoded no dominio:

```ts
const PASSIVE_INCOME_OPS = new Set(['dividend', 'jcp', 'cash_yield', 'securities_lending']);
const PASSIVE_EXPENSE_OPS = new Set(['fee', 'penalty_b3']);
const CAPITAL_OPS = new Set(['capital_deposit', 'capital_withdrawal']);
const OPTION_OPS = new Set(['put_sell', 'put_buy', 'call_sell', 'call_buy']);
const TRADE_OPS = new Set(['buy', 'sell']);
```

Essas regras devem virar catalogo.

---

## 2. Resultado esperado

Ao final da etapa:

1. Existira um catalogo de operacoes INVEST no banco.
2. Existira um `InvestOperationPolicyService`.
3. `InvestOperations` deixara de usar sets fixos para classificar operacao.
4. O comportamento atual sera preservado por seeds.
5. Testes cobrirao cada operacao conhecida.
6. Futuras operacoes poderao ser adicionadas por migration/seed, sem alterar `InvestOperations`.

Importante: esta etapa deve ser behavior-preserving. Nao mudar regra economica ainda; apenas mover a fonte da regra para catalogo.

---

## 3. Escopo exato

### Dentro do escopo

- Criar migrations para tabelas de catalogo de operacoes.
- Criar seeds SQL para todas as operacoes atuais.
- Criar tipos TypeScript da policy.
- Criar `InvestOperationPolicyService`.
- Refatorar `InvestOperations.kindOf()` e os sets principais de `InvestOperations`.
- Adaptar testes existentes ou criar novos testes unitarios.
- Adicionar testes anti-regressao para garantir que operacoes atuais preservam comportamento.

### Fora do escopo

- Nao mexer em broker adapter BTG.
- Nao remover `LedgerImportLine` ainda.
- Nao remover `legacy_op` ainda.
- Nao remover `skip_financial_ledger` ainda.
- Nao alterar abertura fixa `2026-01-01`.
- Nao alterar `CAIXA-BTG` / `CAIXA-DEFAULT`.
- Nao alterar `PatrimonyMtmDailyEngine`.
- Nao refatorar market data.
- Nao trocar endpoints.

Esses itens serao tratados nas etapas seguintes.

---

## 4. Migrations a criar

Criar uma nova migration com o proximo numero disponivel em:

`src/database/migrations/NN_invest_operation_policy_catalog.sql`

Antes de criar, verificar o maior numero existente em `src/database/migrations`.

### 4.1. Tabela `invest_operation_types`

Fonte canonica de operacoes conhecidas pelo INVEST.

```sql
CREATE TABLE IF NOT EXISTS invest_operation_types (
  operation_code VARCHAR(80) NOT NULL,
  module_code VARCHAR(40) NOT NULL DEFAULT 'INVEST',
  canonical_name VARCHAR(180) NOT NULL,
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_code),
  INDEX idx_iot_module_active (module_code, is_active)
);
```

### 4.2. Tabela `invest_operation_policies`

Define o comportamento padrao da operacao.

```sql
CREATE TABLE IF NOT EXISTS invest_operation_policies (
  operation_code VARCHAR(80) NOT NULL,
  business_event_kind VARCHAR(80) NOT NULL,
  affects_portfolio BOOLEAN NOT NULL DEFAULT FALSE,
  affects_financial BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_movement_type VARCHAR(80) NULL,
  cash_direction ENUM('in', 'out', 'none', 'signed') NOT NULL DEFAULT 'none',
  default_financial_status ENUM('pending', 'cleared') NOT NULL DEFAULT 'cleared',
  uses_settlement_rules BOOLEAN NOT NULL DEFAULT FALSE,
  requires_instrument BOOLEAN NOT NULL DEFAULT FALSE,
  requires_cash_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_external_flow_for_twr BOOLEAN NOT NULL DEFAULT FALSE,
  is_trade BOOLEAN NOT NULL DEFAULT FALSE,
  is_option_trade BOOLEAN NOT NULL DEFAULT FALSE,
  is_corporate_action BOOLEAN NOT NULL DEFAULT FALSE,
  is_passive_income BOOLEAN NOT NULL DEFAULT FALSE,
  is_passive_expense BOOLEAN NOT NULL DEFAULT FALSE,
  is_opening BOOLEAN NOT NULL DEFAULT FALSE,
  default_pivot_column VARCHAR(80) NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_code),
  CONSTRAINT fk_iop_operation
    FOREIGN KEY (operation_code) REFERENCES invest_operation_types(operation_code)
    ON DELETE CASCADE,
  INDEX idx_iop_event_kind (business_event_kind),
  INDEX idx_iop_flags (is_trade, is_option_trade, is_passive_income, is_passive_expense)
);
```

### 4.3. Tabela `invest_operation_asset_overrides`

Permite excecoes por tipo de ativo sem alterar codigo.

```sql
CREATE TABLE IF NOT EXISTS invest_operation_asset_overrides (
  id VARCHAR(36) NOT NULL,
  operation_code VARCHAR(80) NOT NULL,
  asset_type VARCHAR(80) NOT NULL,
  affects_portfolio BOOLEAN NULL,
  affects_financial BOOLEAN NULL,
  inventory_movement_type VARCHAR(80) NULL,
  cash_direction ENUM('in', 'out', 'none', 'signed') NULL,
  default_financial_status ENUM('pending', 'cleared') NULL,
  uses_settlement_rules BOOLEAN NULL,
  requires_instrument BOOLEAN NULL,
  requires_cash_account BOOLEAN NULL,
  is_external_flow_for_twr BOOLEAN NULL,
  valid_from DATE NOT NULL DEFAULT '1900-01-01',
  valid_to DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_ioao_operation
    FOREIGN KEY (operation_code) REFERENCES invest_operation_types(operation_code)
    ON DELETE CASCADE,
  INDEX idx_ioao_lookup (operation_code, asset_type, valid_from, valid_to, is_active)
);
```

Observacao: para esta etapa, os overrides podem ficar vazios. A tabela existe para evolucao segura.

---

## 5. Seeds obrigatorios

Popular todas as operacoes atuais de `src/core/invest/ledgerTypes.ts`.

Operacoes conhecidas:

- `buy`
- `sell`
- `dividend`
- `jcp`
- `split`
- `bonus`
- `option_exercise`
- `fee`
- `revaluation`
- `opening_balance`
- `put_sell`
- `put_buy`
- `call_sell`
- `call_buy`
- `securities_lending`
- `capital_deposit`
- `capital_withdrawal`
- `cash_yield`
- `penalty_b3`
- `pending_settlement`
- `cost_adjustment`

### 5.1. Politicas esperadas

Usar este mapa como fonte de verdade inicial. Ele deve preservar o comportamento atual.

| operation_code | business_event_kind | affects_portfolio | affects_financial | inventory_movement_type | cash_direction | status | settlement | requires_instrument | requires_cash_account | external_flow_twr | flags |
|---|---|---:|---:|---|---|---|---:|---:|---:|---:|---|
| opening_balance | opening_balance | true | conditional | opening_balance | signed | cleared | false | false | false | false | is_opening |
| buy | broker_note_spot | true | true | acquisition | out | cleared | true | true | true | false | is_trade |
| sell | broker_note_spot | true | true | disposition | in | cleared | true | true | true | false | is_trade |
| put_sell | broker_note_option | true | true | disposition | in | cleared | true | true | true | false | is_option_trade |
| put_buy | broker_note_option | true | true | acquisition | out | cleared | true | true | true | false | is_option_trade |
| call_sell | broker_note_option | true | true | disposition | in | cleared | true | true | true | false | is_option_trade |
| call_buy | broker_note_option | true | true | acquisition | out | cleared | true | true | true | false | is_option_trade |
| option_exercise | broker_note_option | true | true | signed_quantity | signed | cleared | true | true | true | false | is_option_trade |
| split | corporate_action | true | false | split | none | cleared | false | true | false | false | is_corporate_action |
| bonus | corporate_action | true | false | bonus | none | cleared | false | true | false | false | is_corporate_action |
| revaluation | corporate_action | true | false | revaluation | none | cleared | false | true | false | false | is_corporate_action |
| dividend | cash_movement | false | true | null | in | cleared | false | false | true | false | is_passive_income |
| jcp | cash_movement | false | true | null | in | cleared | false | false | true | false | is_passive_income |
| cash_yield | cash_movement | false | true | null | in | cleared | false | false | false | false | is_passive_income |
| securities_lending | broker_note_loan | conditional | true | cost_adjustment | in | cleared | true | false | true | false | is_passive_income |
| fee | cash_movement | conditional | true | cost_adjustment | out | cleared | false | false | true | false | is_passive_expense |
| penalty_b3 | cash_movement | conditional | true | cost_adjustment | out | cleared | false | false | true | false | is_passive_expense |
| cost_adjustment | cash_movement | true | true | cost_adjustment | out | cleared | false | true | true | false | is_passive_expense |
| capital_deposit | cash_movement | false | true | null | in | cleared | false | false | true | true | capital |
| capital_withdrawal | cash_movement | false | true | null | out | cleared | false | false | true | true | capital |
| pending_settlement | broker_note_spot | false | true | null | signed | pending | true | false | true | false | settlement |

Notas importantes:

1. `conditional` nao deve ser gravado como string em boolean. Para `opening_balance`, `securities_lending`, `fee` e `penalty_b3`, preserve o comportamento atual inicialmente:
   - `opening_balance` de posicao afeta portfolio; abertura de caixa afeta financeiro.
   - `fee` e `penalty_b3` podem gerar ajuste patrimonial quando vierem vinculados a ativo nao-caixa.
   - `securities_lending` pode ter tratamento especifico herdado.
2. Para campos booleanos da tabela, use o comportamento predominante e deixe excecoes para codigo transicional ou `invest_operation_asset_overrides`.
3. Se o agente encontrar ambiguidade, nao inventar regra nova. Preservar o que `InvestOperations` faz hoje e documentar em teste.

### 5.2. Regras para `business_event_kind`

Substituir o metodo atual `InvestOperations.kindOf` por consulta ao catalogo.

Mapa esperado:

- `opening_balance` -> `opening_balance`
- `buy`, `sell`, `pending_settlement` -> `broker_note_spot`
- `put_sell`, `put_buy`, `call_sell`, `call_buy`, `option_exercise` -> `broker_note_option`
- `split`, `bonus`, `revaluation` -> `corporate_action`
- `securities_lending` -> `broker_note_loan`
- demais movimentos de caixa -> `cash_movement`

---

## 6. Novo service: `InvestOperationPolicyService`

Criar arquivo:

`src/core/invest/InvestOperationPolicyService.ts`

### 6.1. Tipos

```ts
export type InvestCashDirection = 'in' | 'out' | 'none' | 'signed';

export type InvestOperationPolicy = {
  operationCode: string;
  businessEventKind: BusinessEventKind;
  affectsPortfolio: boolean;
  affectsFinancial: boolean;
  inventoryMovementType: string | null;
  cashDirection: InvestCashDirection;
  defaultFinancialStatus: 'pending' | 'cleared';
  usesSettlementRules: boolean;
  requiresInstrument: boolean;
  requiresCashAccount: boolean;
  isExternalFlowForTwr: boolean;
  isTrade: boolean;
  isOptionTrade: boolean;
  isCorporateAction: boolean;
  isPassiveIncome: boolean;
  isPassiveExpense: boolean;
  isOpening: boolean;
  defaultPivotColumn: string | null;
};
```

### 6.2. API obrigatoria

```ts
export class InvestOperationPolicyService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async resolve(
    ctx: UserContext,
    input: {
      operationCode: string;
      assetType?: string | null;
      eventDate?: string | null;
    }
  ): Promise<InvestOperationPolicy>;

  async requirePolicy(
    ctx: UserContext,
    operationCode: string
  ): Promise<InvestOperationPolicy>;

  clearCache(): void;
}
```

### 6.3. Regras do service

- Deve carregar apenas policies `is_active = true`.
- Deve aplicar override por `operation_code + asset_type + data`, se existir.
- Override mais especifico ganha por:
  1. `priority` menor primeiro.
  2. `valid_from` mais recente.
- Se a operacao nao existir, lancar `GatewayError('UNKNOWN_INVEST_OPERATION', ...)` com HTTP 400.
- Deve ter cache em memoria por instancia, igual ao padrao de `ModuleCategories`.
- Nao usar fallback silencioso.

---

## 7. Refatoracao de `InvestOperations`

Arquivo:

`src/modules/invest/InvestOperations.ts`

### 7.1. Injecao

Adicionar dependencia:

```ts
private readonly operationPolicies: InvestOperationPolicyService;
```

Instanciar no constructor com `gateway`.

### 7.2. Substituir `kindOf`

Antes:

```ts
private static kindOf(op: string): BusinessEventKind { ... }
```

Depois:

```ts
private async kindOf(ctx: UserContext, op: string): Promise<BusinessEventKind> {
  const policy = await this.operationPolicies.requirePolicy(ctx, op);
  return policy.businessEventKind;
}
```

Atualizar `resolveOrCreateEvent` para ser async com essa chamada.

### 7.3. Substituir sets principais

Remover ou deixar de usar:

- `PASSIVE_INCOME_OPS`
- `PASSIVE_EXPENSE_OPS`
- `CAPITAL_OPS`
- `OPTION_OPS`
- `TRADE_OPS`

No ponto de decisao, resolver policy:

```ts
const policy = await this.operationPolicies.resolve(ctx, {
  operationCode: op,
  assetType,
  eventDate: line.date,
});
```

Exemplos:

- `PASSIVE_INCOME_OPS.has(op)` vira `policy.isPassiveIncome`.
- `PASSIVE_EXPENSE_OPS.has(op)` vira `policy.isPassiveExpense`.
- `CAPITAL_OPS.has(op)` vira `policy.isExternalFlowForTwr` ou flag apropriada.
- `OPTION_OPS.has(op)` vira `policy.isOptionTrade`.
- `TRADE_OPS.has(op)` vira `policy.isTrade`.

### 7.4. Movimento patrimonial

Mapear `policy.inventoryMovementType` para os tipos aceitos por `InventoryLedger`.

Cuidados:

- `option_exercise` hoje calcula movimento por sinal da quantidade. Preserve isso ate uma etapa posterior.
- `signed_quantity` pode ser usado como codigo de policy, mas deve ser traduzido em `InvestOperations` transicionalmente.
- `fee`, `penalty_b3` e `cost_adjustment` devem preservar comportamento atual.

### 7.5. Caixa

Nesta etapa, nao trocar resolucao de conta.

Permitido continuar usando `resolveCashAccount` e `CAIXA-DEFAULT` enquanto a Etapa 2 nao existir.

Mas a decisao de direcao deve vir de `policy.cashDirection`, exceto nos casos transicionais onde o valor assinado ja define direcao.

---

## 8. Arquivos adicionais a adaptar com cuidado

### 8.1. `src/core/invest/cashExtractDedup.ts`

Objetivo: se for simples, substituir sets por `InvestOperationPolicyService`.

Se isso aumentar muito o escopo porque o arquivo e puro/sincrono, fazer apenas:

- manter comportamento;
- adicionar TODO arquitetural claro;
- criar teste que garanta paridade;
- documentar no resultado que sera migrado na etapa de dedup/reconciliation policy.

Nao quebrar deduplicacao para tentar resolver tudo agora.

### 8.2. `src/core/invest/threePricesEngine.ts`

Mesmo criterio:

- Se for viavel injetar policy snapshot sem grande mudanca, fazer.
- Se nao, manter e documentar como pendencia da etapa de valuation/policy snapshot.

### 8.3. `src/core/invest/patrimonyLedgerGates.ts`

Preferivel migrar para policy, pois costuma ter listas pequenas de tipo de movimento.

### 8.4. `src/core/invest/LiqBolsaSettlementService.ts`

Nao alterar matching financeiro profundo nesta etapa se houver risco. Apenas preparar caminho para policy.

---

## 9. Testes obrigatorios

Criar ou atualizar testes em:

`tests/unit/invest/InvestOperationPolicyService.test.ts`

Casos obrigatorios:

1. Resolve `buy` como:
   - `businessEventKind = broker_note_spot`
   - `affectsPortfolio = true`
   - `affectsFinancial = true`
   - `cashDirection = out`
   - `isTrade = true`

2. Resolve `sell` como:
   - cash `in`
   - trade true

3. Resolve `put_sell`, `put_buy`, `call_sell`, `call_buy` como option trade.

4. Resolve `dividend`, `jcp`, `cash_yield` como passive income.

5. Resolve `fee`, `penalty_b3`, `cost_adjustment` como passive expense.

6. Resolve `capital_deposit` e `capital_withdrawal` como fluxo externo para TWR.

7. Resolve `split`, `bonus`, `revaluation` como corporate action sem financeiro.

8. Operacao desconhecida lanca `UNKNOWN_INVEST_OPERATION`.

9. Override por asset_type ganha da policy padrao.

10. Cache pode ser limpo com `clearCache`.

Atualizar testes existentes de:

- `tests/unit/modules/invest/InvestOperations.eventGrouping.test.ts`
- `tests/unit/modules/invest/InvestOperations.coupling.test.ts`
- `tests/unit/modules/invest/InvestOperations.costAdjustment.test.ts`
- `tests/unit/modules/invest/InvestOperations.voidAmend.test.ts`

Todos devem continuar passando.

---

## 10. Validacoes finais obrigatorias

Rodar:

```powershell
npm test -- --runInBand tests/unit/invest/InvestOperationPolicyService.test.ts
npm test -- --runInBand tests/unit/modules/invest
npm run build
```

Se o projeto nao aceitar exatamente esses comandos, usar o equivalente mais proximo com Jest.

Tambem rodar buscas:

```powershell
rg "PASSIVE_INCOME_OPS|PASSIVE_EXPENSE_OPS|CAPITAL_OPS|OPTION_OPS|TRADE_OPS" src/modules/invest src/core/invest
rg "new Set\\(\\['buy'|new Set\\(\\['put_sell'|operation === 'buy'|op === 'buy'" src/modules/invest src/core/invest
```

Resultado esperado:

- Nenhuma ocorrencia em `InvestOperations.ts`.
- Ocorrencias restantes em outros arquivos devem ser justificadas no handoff final do agente.

---

## 11. Criterios de aceite

A etapa so esta concluida se todos os itens abaixo forem verdadeiros:

- [ ] Migration criada com tabelas `invest_operation_types`, `invest_operation_policies`, `invest_operation_asset_overrides`.
- [ ] Seeds incluem todas as operacoes atuais de `LEDGER_TRANSACTION_TYPES`.
- [ ] `InvestOperationPolicyService` implementado.
- [ ] `InvestOperations` usa policy service para `business_event_kind`.
- [ ] `InvestOperations` nao usa mais os sets fixos principais.
- [ ] Comportamento atual de imports e recordOperation preservado.
- [ ] Teste unitario novo cobre todas as operacoes conhecidas.
- [ ] Testes existentes de `InvestOperations` passam.
- [ ] `npm run build` passa.
- [ ] Handoff final lista ocorrencias restantes de regra hardcoded fora de `InvestOperations`, se houver.

---

## 12. Erros comuns a evitar

1. Nao criar regra nova por intuicao. Preserve comportamento atual.
2. Nao apagar `legacy_op` nesta etapa.
3. Nao apagar `skip_financial_ledger` nesta etapa.
4. Nao trocar caixa default nesta etapa.
5. Nao mudar endpoints.
6. Nao transformar parser BTG agora.
7. Nao mudar TWR alem de marcar `is_external_flow_for_twr` no catalogo.
8. Nao fazer fallback para operacao desconhecida; deve falhar alto.
9. Nao usar `module_categories` para semantica de operacao. `module_categories` e para tipo de ativo; operacao fica no novo catalogo.
10. Nao deixar policy hardcoded em TypeScript "temporariamente" sem teste e sem justificativa.

---

## 13. Handoff esperado do agente executor

Ao terminar, o agente deve responder com:

1. Arquivos alterados.
2. Migrations criadas.
3. Seeds adicionados.
4. Testes criados/alterados.
5. Resultado dos comandos de validacao.
6. Lista de hardcodes restantes encontrados por `rg`, com justificativa.
7. Riscos ou pontos que devem ir para Etapa 2.

---

## 14. Proxima etapa apos validacao

Depois que esta etapa for implementada e validada, a Etapa 2 sera:

`INVEST: politica de caixa, contas por broker/organizacao e remocao de CAIXA-BTG/CAIXA-DEFAULT do dominio`.

