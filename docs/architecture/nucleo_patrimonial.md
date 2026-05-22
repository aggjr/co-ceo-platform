# Núcleo patrimonial canônico

Documento de referência permanente. Toda decisão de modelagem de "posições, movimentações, contas e fechamentos" passa por aqui.

## Tese

Os conceitos de **posição, movimentação, localização, fechamento, valoração e conciliação** são **invariantes** entre módulos. O que muda entre INVEST (ações), STOCKSPIN (estoque físico), REAL_ESTATE (imóveis), EDUCATION (cursos digitais) e qualquer módulo futuro não é o conceito — é a **regra específica de domínio**.

Por isso a plataforma tem **um único núcleo** que cuida desses invariantes. Cada módulo é uma **especialização** que adiciona campos próprios (extensões) e plugues de regra (handlers e estratégias).

## Três camadas

```text
┌────────────────────────────────────────────────────────────┐
│ 1. NÚCLEO CANÔNICO  (src/core/)                            │
│    Motores genéricos. Não sabem o que é uma ação ou SKU.   │
│    Sabem tratar "posição com qty + custo + localização     │
│    que se move e é fechada periodicamente".                │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ 2. ESPECIALIZAÇÃO POR MÓDULO  (src/modules/<modulo>/)      │
│    Extensões com campos próprios + plugues no núcleo:      │
│      ValuationStrategy   — como calcular custo médio       │
│      SettlementProfile   — D+N de cada operação            │
│      MovementHandler     — hook em movimentos especiais    │
│                            (exercício de opção, split,     │
│                            transferência entre armazéns)   │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ 3. FEATURE GATE  (CoCeoDataGateway)                        │
│    Antes de criar item: resolve subcategory → source_module│
│    e valida que organization contratou o módulo            │
│    (contract_modules). Sem contrato, sem registro.         │
└────────────────────────────────────────────────────────────┘
```

## Núcleo — `src/core/`

### `inventory/` — qualquer "coisa que se possui"

| Componente | Responsabilidade |
|---|---|
| `InventoryRegistry` | CRUD de `patrimony_items` via gateway |
| `InventoryLocations` | Onde os itens estão (corretora, armazém, endereço, URL, diretório) |
| `InventoryLedger` | Motor de movimentação (acquisition, disposition, transfer, revaluation, write_off) |
| `InventoryValuation` | Interface — cada módulo escolhe sua estratégia (PM ponderado, FIFO, LIFO, três preços, custo + depreciação) |
| `InventoryClosing` | Fechamento periódico genérico (qualquer frequência) |
| `InventoryReconciliation` | Conciliação contra fonte externa (extrato, contagem física, posição B3) |

### `financial/` — qualquer conta com saldo

| Componente | Responsabilidade |
|---|---|
| `FinancialAccountRegistry` | CRUD de `financial_accounts` (banco, corretora, caixa físico, gateway, cartão, linha de crédito) |
| `FinancialLedger` | Extrato — entradas/saídas com `settlement_date` + `status` |
| `SettlementEngine` | Aplica perfil D+N por tipo de operação + tipo de conta |
| `FinancialClosing` | Fechamento periódico (diário/mensal) |

### `patrimony/` — agregação

| Componente | Responsabilidade |
|---|---|
| `ConsolidatedView` | Lê `patrimony_items` + `financial_accounts` + extensões; entrega visão de patrimônio total para CASH (DRE, balanço) e IVA (análise transversal) |

### `module-registry/`

| Componente | Responsabilidade |
|---|---|
| `ModuleCategories` | Catálogo: cada `(category, subcategory)` é "dominada" por um `source_module` |
| `ContractGuard` | Valida `subcategory → source_module → contract_modules` antes de qualquer write |

## Schema do banco

### Núcleo

```text
patrimony_items
  id (uuid)
  organization_id (uuid, fk)
  source_module ('INVEST' | 'STOCKSPIN' | 'REAL_ESTATE' | 'EDUCATION' | 'CASH' | ...)
  category ('financial_asset' | 'inventory' | 'real_estate' | 'fixed_asset' | 'intangible' | ...)
  subcategory ('stock' | 'fii' | 'option_call' | 'option_put' | 'fixed_income' |
               'sku' | 'raw_material' | 'finished_good' |
               'building' | 'land' | 'vehicle' |
               'course' | 'digital_asset' | ...)
  identifier (varchar) — ticker, sku, plate, matrícula
  name (varchar)
  quantity (decimal 18,6) — pode ser fracionário (frações de ação, m² de terreno)
  quantity_unit (varchar) — 'un', 'pc', 'kg', 'l', 'm2'
  acquisition_value (decimal 18,4) — custo total de aquisição em moeda base
  current_value (decimal 18,4) — valor atual (marcado a mercado / contábil)
  acquired_at (date), divested_at (date nullable)
  status ('active' | 'liquidated' | 'written_off')
  metadata (json) — extensão livre
  UNIQUE (organization_id, source_module, identifier)

patrimony_locations
  id, organization_id, location_type, name, address|account_id|url, metadata

patrimony_item_locations
  patrimony_item_id, location_id, quantity_at_location
  (1 item pode estar parcialmente em N lugares — ex: SKU em 2 armazéns)

patrimony_ledger_entries
  id, organization_id, patrimony_item_id, location_id (nullable),
  transaction_date, movement_type (acquisition|disposition|transfer|revaluation|...),
  quantity_delta (decimal 18,6, signed),
  unit_value (decimal 18,6),
  total_value (decimal 18,4),
  related_financial_entry_id (nullable),
  impacts_valuation (bool),
  source_batch_id, broker_note_ref, notes, metadata

patrimony_closings
  id, organization_id, scope ('inventory'|'financial'|'full'),
  period ('daily'|'monthly'|'annual'),
  reference_date, status ('open'|'in_progress'|'closed'),
  metadata (snapshot agregado)
```

### Financeiro

```text
financial_accounts
  id, organization_id, source_module,
  account_type ('checking' | 'savings' | 'brokerage' | 'cash_register' |
                'credit_line' | 'gateway' | 'wallet'),
  external_id (nº na corretora/banco),
  name, currency (default 'BRL'),
  opening_balance, opening_date,
  status ('active'|'closed'), metadata

financial_ledger_entries
  id, organization_id, account_id,
  transaction_date, settlement_date,
  direction ('in'|'out'), amount (decimal 18,4), currency,
  description, counterparty,
  status ('pending'|'cleared'|'cancelled'),
  related_patrimony_ledger_id (nullable),
  source_batch_id, external_ref, metadata

financial_closings
  id, organization_id, account_id (nullable, null = consolidado),
  period, reference_date, opening_balance, closing_balance,
  status, metadata
```

### Module registry

```text
module_categories
  module_code, category, subcategory, canonical_name, description,
  default_quantity_unit, default_valuation_method, default_settlement_profile
  PRIMARY KEY (module_code, category, subcategory)

module_valuation_methods
  method_code ('weighted_avg'|'three_prices_invest'|'fifo'|'lifo'|
               'straight_line_depreciation'|'amortized_production_cost')
  class_path — caminho do TS que implementa InventoryValuation

module_settlement_profiles
  profile_code ('B3_D2'|'NET_30'|'NET_60'|'COD'|'INSTANT'|...)
  days_offset, business_days_only, default_status
```

### Extensões por módulo (exemplos)

```text
invest_position_ext
  patrimony_item_id (FK PK)
  asset_class ('stock'|'option_call'|'option_put'|'fii'|'fixed_income')
  underlying_ticker (nullable),
  option_strike, option_expiration,
  pm_estrito, pm_b3, pm_gerencial,
  last_price, last_price_as_of

stockspin_sku_ext
  patrimony_item_id (FK PK)
  barcode, supplier_id, minimum_stock, reorder_point

stockspin_lot_ext
  id, patrimony_item_id (FK), lot_number,
  manufactured_at, expires_at, quantity_at_lot

real_estate_property_ext
  patrimony_item_id (FK PK)
  full_address, registry_number, iptu_id,
  area_total_m2, area_built_m2, year_built,
  depreciation_method, accumulated_depreciation
```

## Regras invariáveis

1. **Núcleo guarda só o universalmente válido.** Tudo específico de módulo vai para `<modulo>_*_ext`. Sem 80 colunas opcionais no núcleo.
2. **Tipos fortes no domínio TypeScript.** Banco é canônico/genérico; a aplicação tem tipagem por módulo via discriminated unions. Sem pares chave-valor genéricos perambulando pelo código.
3. **Feature gate dentro do gateway.** Não é middleware Express, não é decorator esquecível — é regra do `CoCeoDataGateway.insert/update`. Toda escrita em `patrimony_items` resolve `source_module` e valida `contract_modules`.
4. **Toda operação que move ativo e move dinheiro é uma transação ACID.** Perna de patrimônio + perna(s) financeira(s) em data de liquidação = um único `gateway.transaction()`.
5. **Translators traduzem extratos externos para o livro canônico.** Não existe parser de fornecedor consumindo modelo interno de módulo — ele entrega registros já no formato `patrimony_ledger_entries` / `financial_ledger_entries`.
6. **Idempotência preservada.** O motor genérico mantém a regra "mesma data + mesmo asset + mesmos valores = pergunta antes de duplicar".
7. **`module_categories` é dado, não código.** Adicionar uma nova subcategoria é seed/migration, nunca string hardcoded em service.

## Como um novo módulo entra na plataforma

1. Migration de extensão `<modulo>_*_ext` (FK para `patrimony_items`).
2. Seed em `module_categories` com as subcategorias dominadas.
3. Implementar `ValuationStrategy`, `SettlementProfile` e (se necessário) `MovementHandler` específicos.
4. Translator (opcional) que traduz fontes externas para o livro canônico.
5. Funcionalidades de UI/relatórios próprias.

Nada do núcleo precisa mudar para adicionar um módulo.

## Anti-padrões proibidos

- "Tabela de configuração para regras de negócio" no banco. Regras são código tipado em `src/modules/<modulo>/`.
- Service de módulo que faz `query("SELECT * FROM patrimony_items WHERE source_module != 'INVEST'")` — cada módulo só lê o que é seu, exceto CASH (que tem privilégio de consolidação) e IVA (transversal por design).
- Subcategoria dominada por dois módulos. Cada `(category, subcategory)` é de exatamente um `source_module`.
- Acoplamento entre extensões. `invest_position_ext` não conhece `stockspin_lot_ext`.

## Histórico do estado anterior (referência)

Antes deste documento, INVEST tinha:
- `invest_assets` com `asset_type='cash'` para representar caixa (confusão entre catálogo de ativos e contas financeiras).
- `invest_ledger_entries` com tipos misturando movimento de mercado e movimento puramente financeiro.
- `CustodyEngine` com hacks especiais para tratar caixa como "asset com qty=saldo em R$".
- Hardcode de PU do Tesouro por data.

Tudo isso é removido na migração para este modelo.

## Estado da migração (concluído)

O regime de espelho legado/núcleo foi removido. A fonte única de verdade é o
núcleo canônico:

- **Escrita**: `LedgerImportService.importPortfolio/importOpeningOnly/importEntriesOnly`
  e `InvestOperations.recordOpeningPosition/recordOpeningCash/recordOperation`
  gravam DIRETO em `patrimony_items`, `invest_position_ext`, `invest_option_ext`,
  `financial_accounts`, `patrimony_ledger_entries` e `financial_ledger_entries`.
- **Leitura para engines** (`CustodyEngine`, `threePricesEngine`, `PnLPivotEngine`,
  `PatrimonyMtmDailyEngine`): `LedgerImportService.listLedgerEvents` →
  `LedgerEventProjection` reconstrói `LedgerEvent[]` a partir do núcleo. Os
  engines não sabem que o schema mudou.
- **Leitura de ativos no formato legado** (controllers e serviços que pediam
  `findWhere('invest_assets')`): `InvestAssetProjection.listActiveAssets`
  monta o mesmo shape lendo de `patrimony_items` + `invest_position_ext` +
  `invest_option_ext` + `financial_accounts`.
- **Cotações** (`InvestQuoteSyncService`): grava `last_price` em
  `invest_position_ext.last_price` e strikes de opção em
  `invest_option_ext.strike_price`. Sem mais escrita no metadata legado.

Tabelas removidas (migration `15_drop_legacy_invest_tables.sql`):
- `invest_assets`
- `invest_ledger_entries`
- view `invest_ledger_with_assets`

Tabelas mantidas (caches/projeções derivadas, ainda úteis):
- `invest_portfolio_daily` — série diária consolidada de patrimônio (otimização
  de leitura para o histórico).
- `invest_daily_snapshots` — snapshots históricos de cotações (auditoria).

Idempotência: `InvestOperations.recordOperation` usa
`external_ref = 'BROKER_REF:<broker_note_ref>'` para evitar reimport
duplicado da mesma nota.
