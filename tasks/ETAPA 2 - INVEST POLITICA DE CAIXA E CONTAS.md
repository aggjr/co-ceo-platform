# ETAPA 2 - INVEST: politica de caixa, contas por broker/organizacao e remocao de caixa hardcoded

Status: pronto para implementacao por agente apos validacao da Etapa 1

Objetivo desta etapa: remover do dominio INVEST as convencoes fixas de conta de caixa, especialmente `CAIXA-BTG`, `CAIXA-DEFAULT`, `MAIN_CASH_TICKER` e escolhas implicitas de conta por corretora. Ao final, a conta financeira usada por qualquer evento INVEST deve ser resolvida por catalogo e por um service unico (`InvestCashAccountPolicy`), considerando organizacao, broker, moeda, origem e vigencia.

Esta etapa NAO deve refatorar broker adapters, abertura fixa, market data, patrimonio diario ou endpoints. Ela apenas troca a resolucao de conta/caixa de hardcoded para catalogo.

---

## 1. Contexto arquitetural

A Etapa 1 moveu a semantica de operacoes para catalogo via `InvestOperationPolicyService`.

Agora o problema e caixa. Hoje existem convencoes fixas em varios pontos:

- `src/core/invest/ledgerTypes.ts`
  - `CASH_TICKER_PREFIX = 'CAIXA-'`
  - `MAIN_CASH_TICKER = 'CAIXA-BTG'`
  - `MAIN_CASH_NAME = 'Conta Corrente BTG'`
- `src/modules/invest/InvestOperations.ts`
  - chamadas com `'CAIXA-DEFAULT'`
  - resolucao de conta dependente de convencao
- `src/core/invest/ledgerOperationDedup.ts`
  - fallback para `CAIXA-BTG`
- `src/core/invest/cashInvestLedger.ts`
- `src/core/invest/cashInTransit.ts`
- importadores BTG e servicos de conciliacao que assumem conta BTG

O INVEST precisa suportar multiplas organizacoes e multiplas contas/corretoras:

- BTG
- XP
- Clear
- Necton/BTG legado
- Interactive Brokers
- Binance/cripto
- contas manuais
- contas em BRL, USD ou outras moedas

Portanto, caixa nao pode ser constante global.

---

## 2. Resultado esperado

Ao final da etapa:

1. Existira um catalogo de contas de caixa INVEST por organizacao/broker/moeda.
2. Existira um `InvestCashAccountPolicy`.
3. `InvestOperations` deixara de chamar `resolveCashAccount(ctx, 'CAIXA-DEFAULT', ...)`.
4. Fluxos de caixa usarao policy para descobrir `financial_account_id` e ticker sintetico.
5. `CAIXA-BTG` ficara apenas como dado seedado para ambientes/organizacoes existentes, nao como regra de dominio.
6. O comportamento atual da holding com BTG sera preservado por seed/backfill.

Importante: esta etapa deve ser behavior-preserving para a organizacao atual. A diferenca e que o comportamento passa a vir do banco.

---

## 3. Escopo exato

### Dentro do escopo

- Criar migrations para catalogo de contas de caixa INVEST.
- Criar seeds/backfill para manter a conta BTG atual funcional.
- Criar `InvestCashAccountPolicy`.
- Refatorar `InvestOperations.resolveCashAccount` e chamadas relacionadas.
- Remover uso novo de `CAIXA-DEFAULT`.
- Reduzir ou encapsular uso de `MAIN_CASH_TICKER`.
- Atualizar testes de `InvestOperations` que dependem de caixa.
- Criar testes unitarios dedicados ao policy service.

### Fora do escopo

- Nao transformar endpoints BTG em broker-generic ainda.
- Nao mexer na abertura fixa `2026-01-01`.
- Nao mexer em `BrokerAdapterRegistry`.
- Nao remover `legacy_op`.
- Nao remover `skip_financial_ledger`.
- Nao refatorar `LedgerImportLine`.
- Nao alterar regra de liquidacao.
- Nao alterar TWR/patrimonio diario.
- Nao mudar semantica de operacoes da Etapa 1.

---

## 4. Migrations a criar

Criar nova migration com o proximo numero disponivel:

`src/database/migrations/NN_invest_cash_account_policy.sql`

Antes de criar, verificar o maior numero em `src/database/migrations`.

### 4.1. Tabela `invest_brokers`

Catalogo de brokers/custodiantes/origens financeiras.

```sql
CREATE TABLE IF NOT EXISTS invest_brokers (
  broker_code VARCHAR(80) NOT NULL,
  canonical_name VARCHAR(180) NOT NULL,
  country_code CHAR(2) NULL,
  default_currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (broker_code),
  INDEX idx_invest_brokers_active (is_active)
);
```

### 4.2. Tabela `invest_cash_account_policies`

Resolve qual conta usar para lancamentos financeiros INVEST.

```sql
CREATE TABLE IF NOT EXISTS invest_cash_account_policies (
  id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NULL,
  broker_code VARCHAR(80) NOT NULL,
  source_system VARCHAR(120) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  cash_ticker VARCHAR(120) NOT NULL,
  cash_name VARCHAR(180) NOT NULL,
  financial_account_external_id VARCHAR(180) NOT NULL,
  financial_account_type VARCHAR(80) NOT NULL DEFAULT 'brokerage',
  is_default_for_broker BOOLEAN NOT NULL DEFAULT FALSE,
  is_default_for_currency BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from DATE NOT NULL DEFAULT '1900-01-01',
  valid_to DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_icap_broker
    FOREIGN KEY (broker_code) REFERENCES invest_brokers(broker_code)
    ON DELETE RESTRICT,
  INDEX idx_icap_lookup (
    organization_id,
    broker_code,
    currency_code,
    source_system,
    valid_from,
    valid_to,
    is_active
  ),
  INDEX idx_icap_defaults (organization_id, currency_code, is_default_for_currency, is_active),
  UNIQUE KEY uq_icap_cash_ticker_org (organization_id, cash_ticker)
);
```

### 4.3. Tabela `invest_cash_account_bindings`

Opcional, mas recomendada para evitar lookup repetido depois que a conta financeira foi criada.

```sql
CREATE TABLE IF NOT EXISTS invest_cash_account_bindings (
  id VARCHAR(36) NOT NULL,
  policy_id VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  financial_account_id VARCHAR(36) NOT NULL,
  cash_ticker VARCHAR(120) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_icab_policy
    FOREIGN KEY (policy_id) REFERENCES invest_cash_account_policies(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_icab_policy_org (policy_id, organization_id),
  INDEX idx_icab_account (financial_account_id),
  INDEX idx_icab_cash_ticker (organization_id, cash_ticker)
);
```

Se a arquitetura atual nao permitir FK para `financial_accounts` por restricao de tenant/schema, nao criar FK para ela. Usar apenas `financial_account_id` indexado.

---

## 5. Seeds e backfill obrigatorios

### 5.1. Brokers iniciais

Seed no proprio arquivo da migration:

```sql
INSERT INTO invest_brokers
  (broker_code, canonical_name, country_code, default_currency_code)
VALUES
  ('BTG', 'BTG Pactual', 'BR', 'BRL'),
  ('NECTON_BTG', 'Necton/BTG legado', 'BR', 'BRL'),
  ('XP', 'XP Investimentos', 'BR', 'BRL'),
  ('CLEAR', 'Clear Corretora', 'BR', 'BRL'),
  ('INTERACTIVE_BROKERS', 'Interactive Brokers', 'US', 'USD'),
  ('BINANCE', 'Binance', NULL, 'USD'),
  ('MANUAL', 'Conta manual', NULL, 'BRL')
ON DUPLICATE KEY UPDATE
  canonical_name = VALUES(canonical_name),
  country_code = VALUES(country_code),
  default_currency_code = VALUES(default_currency_code),
  is_active = TRUE;
```

### 5.2. Policy default BTG global

Criar uma policy global que preserve o comportamento atual:

```sql
INSERT INTO invest_cash_account_policies
  (
    id,
    organization_id,
    broker_code,
    source_system,
    currency_code,
    cash_ticker,
    cash_name,
    financial_account_external_id,
    financial_account_type,
    is_default_for_broker,
    is_default_for_currency,
    valid_from,
    priority
  )
VALUES
  (
    'icap-btg-brl-default',
    NULL,
    'BTG',
    NULL,
    'BRL',
    'CAIXA-BTG',
    'Conta Corrente BTG',
    'BTG',
    'brokerage',
    TRUE,
    TRUE,
    '1900-01-01',
    100
  )
ON DUPLICATE KEY UPDATE
  broker_code = VALUES(broker_code),
  currency_code = VALUES(currency_code),
  cash_ticker = VALUES(cash_ticker),
  cash_name = VALUES(cash_name),
  financial_account_external_id = VALUES(financial_account_external_id),
  financial_account_type = VALUES(financial_account_type),
  is_default_for_broker = VALUES(is_default_for_broker),
  is_default_for_currency = VALUES(is_default_for_currency),
  is_active = TRUE;
```

### 5.3. Backfill de contas existentes

Nao tentar adivinhar todas as contas. Fazer backfill seguro:

1. Se existir `financial_accounts` com `source_module = 'INVEST'` e `external_id = 'BTG'`, criar binding para `icap-btg-brl-default`.
2. Se nao existir, o policy service deve criar/registrar a conta quando for usado.

Nao inserir conta financeira diretamente na migration se o padrao do projeto for criar via `FinancialAccountRegistry`.

---

## 6. Novo service: `InvestCashAccountPolicy`

Criar arquivo:

`src/core/invest/InvestCashAccountPolicy.ts`

### 6.1. Tipos

```ts
export type InvestCashAccountResolutionInput = {
  organizationId: string;
  brokerCode?: string | null;
  sourceSystem?: string | null;
  currencyCode?: string | null;
  eventDate?: string | null;
};

export type InvestCashAccountPolicyRow = {
  id: string;
  organization_id: string | null;
  broker_code: string;
  source_system: string | null;
  currency_code: string;
  cash_ticker: string;
  cash_name: string;
  financial_account_external_id: string;
  financial_account_type: string;
  is_default_for_broker: boolean | number;
  is_default_for_currency: boolean | number;
  valid_from: string;
  valid_to: string | null;
  priority: number;
};

export type ResolvedInvestCashAccount = {
  policyId: string;
  brokerCode: string;
  currencyCode: string;
  cashTicker: string;
  cashName: string;
  financialAccountExternalId: string;
  financialAccountType: string;
  financialAccountId?: string;
};
```

### 6.2. API obrigatoria

```ts
export class InvestCashAccountPolicy {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async resolve(
    ctx: UserContext,
    input?: Partial<InvestCashAccountResolutionInput>
  ): Promise<ResolvedInvestCashAccount>;

  async bindFinancialAccount(
    ctx: UserContext,
    input: {
      policyId: string;
      financialAccountId: string;
      cashTicker: string;
      currencyCode: string;
    }
  ): Promise<void>;

  clearCache(): void;
}
```

### 6.3. Regras de resolucao

Input minimo:

- `ctx.organizationId` e obrigatorio.
- Se `brokerCode` nao vier, usar `BTG` apenas como fallback transicional nesta etapa, mas com comentario claro: sera removido quando broker adapters forem genericos.
- `currencyCode` default: `BRL`.
- `eventDate` default: data atual.

Ordem de prioridade:

1. Policy especifica da organizacao + broker + sourceSystem + moeda.
2. Policy especifica da organizacao + broker + moeda.
3. Policy especifica da organizacao + default da moeda.
4. Policy global + broker + sourceSystem + moeda.
5. Policy global + broker + moeda.
6. Policy global default da moeda.

Dentro do mesmo nivel:

1. Menor `priority`.
2. `valid_from` mais recente.

Se nada for encontrado:

- Lancar `GatewayError('INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND', ...)` com HTTP 400.
- Nao criar `CAIXA-BTG` no codigo como fallback silencioso.

### 6.4. Binding

O service deve tentar localizar binding existente em `invest_cash_account_bindings`.

Se existir, retornar `financialAccountId`.

Se nao existir, `InvestOperations` deve usar `FinancialAccountRegistry.register` com:

- `sourceModule = 'INVEST'`
- `accountType = policy.financialAccountType`
- `name = policy.cashName`
- `externalId = policy.financialAccountExternalId`
- `metadata = { broker_code, cash_ticker, currency_code, cash_policy_id }`

Depois deve chamar `bindFinancialAccount`.

---

## 7. Refatoracao de `InvestOperations`

Arquivo:

`src/modules/invest/InvestOperations.ts`

### 7.1. Adicionar dependencia

Adicionar:

```ts
private readonly cashPolicy: InvestCashAccountPolicy;
```

Instanciar no constructor:

```ts
this.cashPolicy = new InvestCashAccountPolicy(gateway);
```

### 7.2. Refatorar `resolveCashAccount`

Localizar metodo atual `resolveCashAccount`.

Ele deve passar a:

1. chamar `this.cashPolicy.resolve(ctx, { brokerCode, sourceSystem, currencyCode, eventDate })`;
2. se ja houver `financialAccountId` no retorno, usar;
3. se nao houver, registrar conta via `FinancialAccountRegistry`;
4. bindar a conta;
5. retornar `{ accountId, cashTicker, policy }`.

Assinatura recomendada:

```ts
private async resolveCashAccount(
  ctx: UserContext,
  input?: {
    brokerCode?: string | null;
    sourceSystem?: string | null;
    currencyCode?: string | null;
    eventDate?: string | null;
  }
): Promise<{
  accountId: string;
  cashTicker: string;
  policy: ResolvedInvestCashAccount;
}>;
```

### 7.3. Remover chamadas com `CAIXA-DEFAULT`

Substituir:

```ts
await this.resolveCashAccount(ctx, 'CAIXA-DEFAULT', line.date)
```

por:

```ts
await this.resolveCashAccount(ctx, {
  brokerCode: line.broker_code ?? line.counterparty ?? 'BTG',
  sourceSystem: line.source_system ?? null,
  currencyCode: line.currency ?? 'BRL',
  eventDate: line.date,
});
```

Se `LedgerImportLine` ainda nao tiver `broker_code` ou `currency`, nao ampliar demais o DTO nesta etapa se isso gerar muito impacto. Pode usar:

- `line.counterparty`
- `line.source_system`
- fallback transicional para `BTG`

Mas o fallback deve ficar dentro de helper local claro, nao espalhado:

```ts
private brokerCodeFromLine(line: LedgerImportLine): string {
  // Transitional default until broker adapters provide brokerCode explicitly.
  return 'BTG';
}
```

### 7.4. `recordOpeningCash`

`recordOpeningCash` recebe `brokerCode`. Deve usar esse valor para resolver/criar conta.

Nao montar nome com:

```ts
const name = input.accountName ?? `Caixa ${input.brokerCode}`;
```

sem antes consultar policy. Usar:

- `input.accountName` se vier explicito;
- senao `policy.cashName`.

### 7.5. Metadata

Todas as entradas financeiras criadas apos esta etapa devem incluir metadata:

```ts
{
  broker_code: policy.brokerCode,
  cash_ticker: policy.cashTicker,
  currency_code: policy.currencyCode,
  cash_policy_id: policy.policyId,
  ...
}
```

Nao remover `legacy_op` ainda.

---

## 8. `ledgerTypes.ts`

Arquivo:

`src/core/invest/ledgerTypes.ts`

### 8.1. Constantes

Nao apagar imediatamente se muitos imports dependem delas. Nesta etapa:

- Marcar `MAIN_CASH_TICKER` e `MAIN_CASH_NAME` como deprecated.
- Garantir que codigo novo nao use essas constantes.
- Manter `CASH_TICKER_PREFIX = 'CAIXA-'` apenas como convencao de exibicao, nao como regra de resolucao.

Comentario esperado:

```ts
/**
 * @deprecated Use InvestCashAccountPolicy. Mantido apenas para compatibilidade
 * com testes e importadores legados ate a remocao final.
 */
export const MAIN_CASH_TICKER = 'CAIXA-BTG';
```

---

## 9. Arquivos adicionais a adaptar com cuidado

### 9.1. `ledgerOperationDedup.ts`

Se houver fallback direto para `CAIXA-BTG`, substituir por dado vindo do evento/metadata quando disponivel.

Se a funcao for pura e nao puder consultar banco:

- adicionar parametro opcional `cashTickerByBroker?: Map<string, string>` ou `defaultCashTicker?: string`;
- manter fallback deprecated somente quando parametro nao vier;
- cobrir com teste.

### 9.2. `cashInvestLedger.ts`

Remover dependencia semantica de BTG quando for resolucao de conta. Labels podem continuar mencionando BTG se forem tela/compatibilidade.

### 9.3. `cashInTransit.ts`

Nao alterar regra de liquidacao nesta etapa. Apenas garantir que previsoes de caixa nao dependam de `CAIXA-BTG` para funcionar.

### 9.4. `btgUploadImportService.ts`

Nao transformar em broker-generic. Apenas garantir que linhas importadas carreguem informacao suficiente para `InvestOperations` resolver broker BTG via policy.

Permitido manter strings BTG neste arquivo, pois e importador especifico BTG.

### 9.5. Controllers

Nao alterar contratos publicos nesta etapa. Se controller precisar mostrar conta, buscar do policy/service em vez de assumir BTG.

---

## 10. Testes obrigatorios

Criar:

`tests/unit/invest/InvestCashAccountPolicy.test.ts`

Casos obrigatorios:

1. Resolve policy global BTG BRL.
2. Resolve policy especifica da organizacao antes da global.
3. Resolve policy com `sourceSystem` mais especifica antes da generica.
4. Resolve default por moeda quando broker nao vier.
5. Respeita vigencia `valid_from` / `valid_to`.
6. Respeita menor `priority`.
7. Retorna binding existente quando houver.
8. `bindFinancialAccount` cria binding idempotente.
9. Sem policy lanca `INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND`.
10. `clearCache` permite recarregar policy alterada.

Atualizar testes existentes:

- `tests/unit/modules/invest/InvestOperations.coupling.test.ts`
- `tests/unit/modules/invest/InvestOperations.costAdjustment.test.ts`
- `tests/unit/modules/invest/InvestOperations.eventGrouping.test.ts`
- `tests/unit/modules/invest/InvestOperations.voidAmend.test.ts`
- testes de cash ledger/dedup que dependem de `CAIXA-BTG`

Objetivo dos testes:

- Compra usa conta resolvida por policy.
- Venda usa conta resolvida por policy.
- Taxa usa conta resolvida por policy.
- Abertura de caixa usa conta resolvida por `brokerCode`.
- Metadata financeira contem `cash_policy_id`, `cash_ticker`, `broker_code`, `currency_code`.

---

## 11. Validacoes finais obrigatorias

Rodar:

```powershell
npm test -- --runInBand tests/unit/invest/InvestCashAccountPolicy.test.ts
npm test -- --runInBand tests/unit/modules/invest
npm test -- --runInBand tests/unit/invest/cashInvestLedger.test.ts
npm test -- --runInBand tests/unit/invest/cashInTransit.test.ts
npm run build
```

Se algum comando nao existir exatamente, usar o equivalente mais proximo.

Rodar buscas:

```powershell
rg "CAIXA-DEFAULT" src/modules/invest src/core/invest src/controllers
rg "MAIN_CASH_TICKER|CAIXA-BTG|Conta Corrente BTG" src/modules/invest src/core/invest src/controllers
rg "resolveCashAccount\\(ctx, 'CAIXA|resolveCashAccount\\(ctx, `" src/modules/invest src/core/invest
```

Resultado esperado:

- `CAIXA-DEFAULT` nao deve aparecer em `InvestOperations`.
- `CAIXA-BTG` pode aparecer em:
  - seed/migration;
  - adapter/importador BTG;
  - testes;
  - constantes deprecated;
  - labels de UI;
  - documentacao.
- Se aparecer em dominio generico, justificar no handoff.

---

## 12. Criterios de aceite

A etapa so esta concluida se:

- [ ] Migration criada com `invest_brokers`, `invest_cash_account_policies`, `invest_cash_account_bindings`.
- [ ] Seed global BTG BRL preserva comportamento atual.
- [ ] `InvestCashAccountPolicy` implementado.
- [ ] `InvestOperations.resolveCashAccount` usa policy.
- [ ] `InvestOperations` nao chama mais `resolveCashAccount` com `'CAIXA-DEFAULT'`.
- [ ] Entradas financeiras novas recebem metadata de policy/caixa.
- [ ] `recordOpeningCash` usa policy para nome/external id quando input nao vier explicito.
- [ ] Testes unitarios do policy passam.
- [ ] Testes existentes de `InvestOperations` passam.
- [ ] `npm run build` passa.
- [ ] Handoff final lista ocorrencias restantes de `CAIXA-BTG` e justifica cada uma.

---

## 13. Erros comuns a evitar

1. Nao substituir `CAIXA-BTG` por outro hardcode como `DEFAULT_BROKER = 'BTG'` espalhado.
2. Se precisar de fallback transicional para BTG, centralizar em um helper com comentario.
3. Nao criar conta financeira diretamente na migration se o padrao do sistema e `FinancialAccountRegistry`.
4. Nao quebrar organizacoes existentes que ja usam external_id `BTG`.
5. Nao mudar nomes publicos de endpoints.
6. Nao apagar constantes deprecated antes de checar todos os imports.
7. Nao acoplar policy de caixa a `module_categories`; categorias sao de ativos, nao de contas.
8. Nao inferir moeda por ticker de ativo nesta etapa.
9. Nao mexer em settlement D+N aqui.
10. Nao transformar importador BTG em generico nesta etapa.

---

## 14. Handoff esperado do agente executor

Ao terminar, o agente deve responder com:

1. Arquivos alterados.
2. Migrations criadas.
3. Seeds/backfills adicionados.
4. Testes criados/alterados.
5. Resultado dos comandos de validacao.
6. Resultado dos `rg` para `CAIXA-DEFAULT`, `CAIXA-BTG`, `MAIN_CASH_TICKER`.
7. Justificativa para cada hardcode restante.
8. Riscos ou pontos que devem ir para Etapa 3.

---

## 15. Proxima etapa apos validacao

Depois que esta etapa for implementada e validada, a Etapa 3 sera:

`INVEST: periodos do livro, abertura configuravel por organizacao e remocao de datas base hardcoded`.

