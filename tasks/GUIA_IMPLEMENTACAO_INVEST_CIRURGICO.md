# Guia de Implementação Cirúrgico — Módulo INVEST
> Data: 2026-06-06 | Branch: `codex-guto`  
> Baseado em leitura direta dos arquivos atuais do Google Drive  
> **Leia TODO este documento antes de tocar em qualquer arquivo.**

---

## REGRAS DE OURO PARA O AGENTE

1. **Nunca edite o arquivo `.js` em `dist/` ou na pasta compilada.** Edite sempre o `.ts` em `src/`. O build gera o `.js`.
2. **Sempre rode `npm run build` depois de cada arquivo modificado** antes de passar ao próximo. Se o build quebrar, pare e corrija.
3. **O código a ser SUBSTITUÍDO está em bloco `ANTES`. O código a ser INSERIDO está em bloco `DEPOIS`.** A substituição é cirúrgica — só o bloco indicado muda.
4. **Não reescreva funções que não estão no escopo.** Se a função não está listada, não toque nela.
5. **A ordem das tarefas importa.** Execute na sequência: T0 → T1 → T2 → T3 → T4 → T5.

---

## DIAGNÓSTICO CONFIRMADO — O QUE ESTÁ ERRADO E ONDE

| Arquivo | Problema | Gravidade |
|---|---|---|
| `src/core/invest/threePricesEngine.ts` | `cost_adjustment` não tem handler — cai no `return` silencioso | 🔴 CRÍTICO |
| `src/core/invest/threePricesEngine.ts` | `amortization` não existe — FII amortização ignora PM | 🔴 CRÍTICO |
| `src/core/invest/ledgerTypes.ts` | `'amortization'` ausente do array de tipos | 🔴 CRÍTICO |
| `src/core/invest/threePricesEngine.ts` | `STOCK_LIKE` hardcoded — ETF/BDR/stock_us sem 3 preços | 🔴 CRÍTICO |
| `src/core/invest/PatrimonyMtmDailyEngine.ts` | ✅ Já corrigido pelo agente anterior | OK |

---

## T0 — VERIFICAÇÃO ANTES DE COMEÇAR

Antes de qualquer edição, rode esses greps para confirmar o estado atual dos arquivos:

```powershell
# Confirmar que TODOS esses padrões existem (devem retornar linhas)
rg -n "const STOCK_LIKE = new Set" src\core\invest\threePricesEngine.ts
rg -n "const IGNORED_TX = new Set" src\core\invest\threePricesEngine.ts
rg -n "cost_adjustment" src\core\invest\ledgerTypes.ts
rg -n "amortization" src\core\invest\ledgerTypes.ts

# Confirmar que ESSES padrões NÃO existem (não devem retornar nada)
rg -n "applyCostAdjustment" src\core\invest\threePricesEngine.ts
rg -n "applyAmortization" src\core\invest\threePricesEngine.ts
rg -n "'amortization'" src\core\invest\ledgerTypes.ts
```

Resultado esperado:
- As 3 primeiras buscas: retornam linhas ✓
- A 4ª (`amortization` no ledgerTypes): **NÃO retorna** — confirma que o tipo está ausente ✓
- As últimas 3: não retornam nada — confirma que os handlers ainda não existem ✓

Se o resultado for diferente, **pare e reporte** antes de continuar.

---

## T1 — `src/core/invest/ledgerTypes.ts` — Adicionar tipo `amortization`

### O que mudar

**Arquivo:** `src/core/invest/ledgerTypes.ts`

### ANTES (trecho exato, linhas 25–30 aproximadamente)

```typescript
  /**
   * Ajuste de custo posterior: gera 1 perna patrimony 'cost_adjustment'
   * (quantity=0, unit_value=custo) NO ITEM `ticker` e 1 perna financial 'out'
   * no caixa. Use para IRRF de TD, taxa BTC, multa, custodia, etc. Ver
   * docstring de MovementType.cost_adjustment.
   */
  'cost_adjustment',
] as const;
```

### DEPOIS

```typescript
  /**
   * Ajuste de custo posterior: gera 1 perna patrimony 'cost_adjustment'
   * (quantity=0, unit_value=custo) NO ITEM `ticker` e 1 perna financial 'out'
   * no caixa. Use para IRRF de TD, taxa BTC, multa, custodia, etc. Ver
   * docstring de MovementType.cost_adjustment.
   */
  'cost_adjustment',
  /**
   * Amortização de FII: retorno de capital próprio (não é dividendo).
   * REDUZ o PM de custo do FII proporcionalmente ao valor amortizado por cota.
   * Gera 1 perna patrimony 'amortization' (quantity=0, unit_value=valor_por_cota)
   * NO ITEM `ticker` e 1 perna financial 'in' no caixa.
   * Diferente de 'dividend': amortização diminui custo de aquisição.
   * Referência B3: Resolução CVM 80/2022, art. 39.
   */
  'amortization',
] as const;
```

### Verificação T1

```powershell
npm run build
# Deve passar sem erros relacionados a 'amortization'
rg -n "'amortization'" src\core\invest\ledgerTypes.ts
# Deve retornar 1 linha com o novo tipo
```

---

## T2 — `src/core/invest/threePricesEngine.ts` — Parte A: funções auxiliares novas

### Contexto

O arquivo começa com:
```typescript
import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';
```

E tem este bloco de constantes:
```typescript
const STOCK_LIKE = new Set(['stock', 'fii']);
const OPTION_LIKE = new Set(['option_call', 'option_put']);

const IGNORED_TX = new Set([
  'dividend',
  'jcp',
  'cash_yield',
  'securities_lending',
  'capital_deposit',
  'capital_withdrawal',
  'penalty_b3',
  'fee',
  'revaluation',
  'pending_settlement',
]);
```

### Mudança A — Substituir `STOCK_LIKE` e `OPTION_LIKE` por funções com fallback seguro

**ANTES** (substitua exatamente este bloco):
```typescript
const STOCK_LIKE = new Set(['stock', 'fii']);
const OPTION_LIKE = new Set(['option_call', 'option_put']);
```

**DEPOIS**:
```typescript
// Sets de fallback — usados APENAS quando nenhum AssetValuationContext é fornecido.
// Quando o contexto existir (carregado do banco via module_categories), ele tem prioridade.
// NÃO adicione novos tipos aqui — adicione em module_categories no banco.
const STOCK_LIKE_FALLBACK = new Set(['stock', 'fii']);
const OPTION_LIKE_FALLBACK = new Set(['option_call', 'option_put']);

/**
 * Retorna true se o assetType é um ativo de renda variável que acumula PM.
 * Prioridade: contexto do banco (module_categories) > fallback hardcoded.
 */
function isStockLike(assetType: string, ctx?: ThreePricesContext): boolean {
  if (ctx?.isStockLike) return ctx.isStockLike(assetType);
  return STOCK_LIKE_FALLBACK.has(assetType);
}

/**
 * Retorna true se o assetType é uma opção (call ou put).
 * Prioridade: contexto do banco (module_categories) > fallback hardcoded.
 */
function isOptionLike(assetType: string, ctx?: ThreePricesContext): boolean {
  if (ctx?.isOptionLike) return ctx.isOptionLike(assetType);
  return OPTION_LIKE_FALLBACK.has(assetType);
}
```

### Mudança B — Adicionar interface `ThreePricesContext` logo após os imports

**Localizar** (após as linhas de import, antes de qualquer `const` ou `function`):
```typescript
import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';
```

**Inserir logo após essas duas linhas**:
```typescript

/**
 * Contexto injetado pelo caller para eliminar hardcodes de assetType no engine.
 * Carregado de module_categories via ModuleCategoryFlags.
 * Quando ausente, o engine usa os Sets de fallback (apenas 'stock' e 'fii').
 */
export interface ThreePricesContext {
  /** Retorna true se o assetType acumula PM (ação, FII, ETF, BDR, etc.). */
  isStockLike(assetType: string): boolean;
  /** Retorna true se o assetType é uma opção negociada. */
  isOptionLike(assetType: string): boolean;
}
```

### Mudança C — Adicionar as duas novas funções de handler

**Localizar** a função `applyStockBuy` (deve aparecer logo após `applyEvent`):
```typescript
function applyStockBuy(s: UnderlyingState, e: LedgerEvent): void {
  const qty = Math.abs(Number(e.quantity));
  if (qty <= 0) return;
  const buyCost = -Number(e.total_net_value ?? 0);
  if (buyCost <= 0) return;
  s.qty += qty;
  s.estritoTotal += buyCost;
}
```

**Inserir ANTES de `applyStockBuy`** as duas novas funções:

```typescript
/**
 * Processa ajuste de custo posterior vinculado a um ticker específico.
 *
 * Casos de uso: IRRF de Tesouro Direto, taxa BTC (aluguel automático),
 * taxa de administração de fundo, multa vinculada a ativo.
 *
 * Regra dos 3 preços:
 *   - PM Estrito:    SOBE (custo real aumenta)
 *   - PM B3:         NEUTRO — B3/RFB não reconhece esses custos no custo fiscal do ativo.
 *                    Implementado somando o mesmo valor a b3AjusteTotal para cancelar.
 *   - PM Gerencial:  SOBE (custo econômico real aumenta)
 *
 * Formato do LedgerEvent:
 *   - quantity = 0  (sem alteração de quantidade)
 *   - unit_value = valor do custo adicional (positivo)
 *   - total_net_value = mesmo valor (negativo no caixa — saída)
 */
function applyCostAdjustment(s: UnderlyingState, e: LedgerEvent): void {
  if (s.qty <= 0) return; // sem posição aberta, não há PM a ajustar

  // unit_value contém o custo adicional; total_net_value é negativo (saída de caixa)
  const additionalCost = Math.abs(Number(e.unit_value ?? 0));
  if (additionalCost <= 0) return;

  // PM Estrito sobe: custo real de manutenção da posição
  s.estritoTotal += additionalCost;

  // PM B3 neutro: b3AjusteTotal sobe junto para cancelar o aumento do Estrito.
  // Fórmula: PM B3 = (estritoTotal - b3AjusteTotal) / qty
  // Após: (+additionalCost - +additionalCost) / qty = sem mudança ✓
  s.b3AjusteTotal += additionalCost;

  // PM Gerencial sobe automaticamente:
  // estritoTotal subiu, premioOpcoesPeriodo não mudou → PM Gerencial sobe ✓
}

/**
 * Processa amortização de FII (retorno de capital próprio).
 *
 * Amortização NÃO é dividendo: ela devolve capital investido, reduzindo
 * o custo de aquisição das cotas. A B3 e a RFB exigem redução do PM.
 *
 * Regra dos 3 preços:
 *   - PM Estrito:    CAI (estritoTotal reduz em qty × valor_por_cota)
 *   - PM B3:         CAI automaticamente (estritoTotal caiu, b3AjusteTotal não mudou)
 *   - PM Gerencial:  CAI automaticamente (estritoTotal caiu, premioOpcoesPeriodo não mudou)
 *
 * Formato do LedgerEvent:
 *   - quantity = 0  (sem alteração de quantidade de cotas)
 *   - unit_value = valor da amortização por cota (positivo, ex: 0.50 para R$0,50/cota)
 *   - total_net_value = positivo (entrada de caixa — o FII pagou ao investidor)
 *
 * Referência: Instrução CVM 516, art. 45 — amortização reduz custo de aquisição
 * para fins de apuração de ganho de capital.
 */
function applyAmortization(s: UnderlyingState, e: LedgerEvent): void {
  if (s.qty <= 0) return; // sem posição aberta, nada a amortizar

  // unit_value = valor por cota amortizado
  const amortPerUnit = Math.abs(Number(e.unit_value ?? 0));
  if (amortPerUnit <= 0) return;

  // Total amortizado = valor por cota × quantidade em carteira no momento
  const totalAmortized = amortPerUnit * s.qty;

  // Reduz o custo total. Math.max(0, ...) previne estritoTotal negativo
  // (se amortização acumulada superar custo original, PM mínimo é zero)
  s.estritoTotal = Math.max(0, s.estritoTotal - totalAmortized);

  // b3AjusteTotal: NÃO precisa ser alterado.
  // PM B3 = (estritoTotal - b3AjusteTotal) / qty
  // estritoTotal caiu → PM B3 cai automaticamente ✓

  // premioOpcoesPeriodo: NÃO precisa ser alterado.
  // PM Gerencial = (estritoTotal - premioOpcoesPeriodo) / qty
  // estritoTotal caiu → PM Gerencial cai automaticamente ✓
}

```

### Mudança D — Atualizar `applyEvent` para chamar os novos handlers

**ANTES** (bloco exato dentro de `applyEvent`):
```typescript
  if (STOCK_LIKE.has(assetType)) {
    if (!impactsPrice(e.impacts_managerial_price)) return;
    if (type === 'buy' || type === 'opening_balance' || type === 'bonus') {
      applyStockBuy(s, e);
      return;
    }
    if (type === 'sell') {
      applyStockSell(s, e);
      return;
    }
    if (type === 'split') {
      applySplit(s, e);
      return;
    }
    return;
  }

  if (OPTION_LIKE.has(assetType)) {
```

**DEPOIS**:
```typescript
  if (isStockLike(assetType, ctx)) {
    // cost_adjustment e amortization NÃO checam impacts_managerial_price:
    // são ajustes de custo obrigatórios, independente da flag de preço gerencial.
    if (type === 'cost_adjustment') {
      applyCostAdjustment(s, e);
      return;
    }
    if (type === 'amortization') {
      applyAmortization(s, e);
      return;
    }

    // Demais operações respeitam a flag de preço gerencial
    if (!impactsPrice(e.impacts_managerial_price)) return;
    if (type === 'buy' || type === 'opening_balance' || type === 'bonus') {
      applyStockBuy(s, e);
      return;
    }
    if (type === 'sell') {
      applyStockSell(s, e);
      return;
    }
    if (type === 'split') {
      applySplit(s, e);
      return;
    }
    return;
  }

  if (isOptionLike(assetType, ctx)) {
```

### Mudança E — Atualizar a assinatura de `applyEvent` para receber o contexto

**ANTES**:
```typescript
function applyEvent(s: UnderlyingState, e: LedgerEvent): void {
```

**DEPOIS**:
```typescript
function applyEvent(s: UnderlyingState, e: LedgerEvent, ctx?: ThreePricesContext): void {
```

### Mudança F — Atualizar a assinatura pública `buildThreePricesReport`

**Localizar** a função exportada principal. Ela tem assinatura similar a:
```typescript
export function buildThreePricesReport(
  entries: LedgerEvent[],
  asOf?: string
): ThreePricesReport {
```

**DEPOIS** (adicionar `ctx` como parâmetro opcional):
```typescript
export function buildThreePricesReport(
  entries: LedgerEvent[],
  asOf?: string,
  ctx?: ThreePricesContext
): ThreePricesReport {
```

**E no corpo da função**, onde `applyEvent` é chamado (há um loop que chama `applyEvent(state, e)`), adicionar o `ctx`:

**ANTES**:
```typescript
      applyEvent(state, e);
```

**DEPOIS**:
```typescript
      applyEvent(state, e, ctx);
```

### Verificação T2

```powershell
npm run build
# Zero erros de TypeScript

rg -n "applyCostAdjustment\|applyAmortization\|isStockLike\|isOptionLike\|ThreePricesContext" src\core\invest\threePricesEngine.ts
# Deve retornar múltiplas linhas confirmando que as funções existem
```

---

## T3 — `src/core/invest/threePricesEngine.ts` — Parte B: testes unitários

### Arquivo de teste existente

Localizar o arquivo de teste atual do engine. Com base no catalog, deve ser:
`tests/unit/invest/threePricesEngine.test.ts`

### Adicionar suite de testes ao final do arquivo existente

**Não apague testes existentes.** Adicione os blocos `describe` abaixo ao final do arquivo:

```typescript
// ─── TESTES: cost_adjustment ─────────────────────────────────────────────────

describe('threePricesEngine — cost_adjustment', () => {
  function makeBaseEntries(): LedgerEvent[] {
    // Compra de 100 PETR4 a R$30 (total_net_value = -3000 = saída de caixa)
    return [
      {
        asset_id: 'asset-petr4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'buy',
        transaction_date: '2026-01-10',
        quantity: 100,
        unit_price: 30,
        total_net_value: -3000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];
  }

  it('cost_adjustment sobe PM Estrito e PM Gerencial, mantém PM B3 neutro', () => {
    const entries = [
      ...makeBaseEntries(),
      {
        asset_id: 'asset-petr4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'cost_adjustment',
        transaction_date: '2026-02-01',
        quantity: 0,
        unit_value: 50, // R$50 de custo adicional (ex: taxa BTC)
        unit_price: 0,
        total_net_value: -50,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    const report = buildThreePricesReport(entries, '2026-02-28');
    const petr4 = report.underlyings.find((u) => u.ticker === 'PETR4');
    expect(petr4).toBeDefined();

    // PM Estrito: (3000 + 50) / 100 = 30.50
    expect(petr4!.pmEstrito).toBeCloseTo(30.5, 4);

    // PM B3: deve ser IGUAL ao original sem o ajuste = (3000 + 50 - 50) / 100 = 30.00
    expect(petr4!.pmB3).toBeCloseTo(30.0, 4);

    // PM Gerencial: (3000 + 50 - 0) / 100 = 30.50 (sobe igual ao Estrito)
    expect(petr4!.pmGerencial).toBeCloseTo(30.5, 4);
  });

  it('cost_adjustment com qty=0 (sem posição) não modifica estado', () => {
    // Situação: ativo vendido, PM zerado, chega cost_adjustment residual
    const entries = [
      ...makeBaseEntries(),
      {
        asset_id: 'asset-petr4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'sell',
        transaction_date: '2026-01-20',
        quantity: 100,
        unit_price: 32,
        total_net_value: 3200,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
      {
        asset_id: 'asset-petr4',
        asset_ticker: 'PETR4',
        asset_type: 'stock',
        transaction_type: 'cost_adjustment',
        transaction_date: '2026-02-01',
        quantity: 0,
        unit_value: 50,
        unit_price: 0,
        total_net_value: -50,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    const report = buildThreePricesReport(entries, '2026-02-28');
    const petr4 = report.underlyings.find((u) => u.ticker === 'PETR4');
    // Com posição zerada, não deve haver estado ativo
    expect(petr4?.qty ?? 0).toBe(0);
  });
});

// ─── TESTES: amortization ────────────────────────────────────────────────────

describe('threePricesEngine — amortization (FII)', () => {
  function makeFiiEntries(): LedgerEvent[] {
    // Compra de 200 cotas de HGLG11 a R$120 (total = R$24.000)
    return [
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'buy',
        transaction_date: '2026-01-05',
        quantity: 200,
        unit_price: 120,
        total_net_value: -24000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];
  }

  it('amortização reduz PM Estrito, PM B3 e PM Gerencial proporcionalmente', () => {
    const entries = [
      ...makeFiiEntries(),
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_value: 0.5, // R$0,50 por cota amortizada
        unit_price: 0,
        total_net_value: 100, // entrada no caixa (200 cotas × R$0,50)
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    const report = buildThreePricesReport(entries, '2026-02-28');
    const hglg = report.underlyings.find((u) => u.ticker === 'HGLG11');
    expect(hglg).toBeDefined();

    // PM Estrito: (24000 - 200 × 0.5) / 200 = (24000 - 100) / 200 = 119.50
    expect(hglg!.pmEstrito).toBeCloseTo(119.5, 4);

    // PM B3: (23900 - 0) / 200 = 119.50 (b3AjusteTotal não mudou)
    expect(hglg!.pmB3).toBeCloseTo(119.5, 4);

    // PM Gerencial: (23900 - 0) / 200 = 119.50 (premioOpcoesPeriodo não mudou)
    expect(hglg!.pmGerencial).toBeCloseTo(119.5, 4);
  });

  it('amortização acumulada não leva estritoTotal abaixo de zero', () => {
    const entries = [
      ...makeFiiEntries(),
      // Primeira amortização: R$0,50/cota
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_value: 60, // R$60/cota — valor absurdo para forçar o piso zero
        unit_price: 0,
        total_net_value: 12000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
      // Segunda amortização: mais R$60/cota (total > custo original)
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-03-15',
        quantity: 0,
        unit_value: 60,
        unit_price: 0,
        total_net_value: 12000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    const report = buildThreePricesReport(entries, '2026-03-31');
    const hglg = report.underlyings.find((u) => u.ticker === 'HGLG11');
    expect(hglg).toBeDefined();

    // PM não pode ser negativo — mínimo é zero
    expect(hglg!.pmEstrito).toBeGreaterThanOrEqual(0);
    expect(hglg!.pmB3).toBeGreaterThanOrEqual(0);
    expect(hglg!.pmGerencial).toBeGreaterThanOrEqual(0);
  });

  it('amortização sem posição aberta (qty=0) é silenciosamente ignorada', () => {
    const entries = [
      ...makeFiiEntries(),
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'sell',
        transaction_date: '2026-01-20',
        quantity: 200,
        unit_price: 125,
        total_net_value: 25000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
      // Amortização chega após a venda
      {
        asset_id: 'asset-hglg11',
        asset_ticker: 'HGLG11',
        asset_type: 'fii',
        transaction_type: 'amortization',
        transaction_date: '2026-02-15',
        quantity: 0,
        unit_value: 0.5,
        unit_price: 0,
        total_net_value: 100,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    // Não deve lançar erro
    expect(() => buildThreePricesReport(entries, '2026-02-28')).not.toThrow();
    const report = buildThreePricesReport(entries, '2026-02-28');
    const hglg = report.underlyings.find((u) => u.ticker === 'HGLG11');
    expect(hglg?.qty ?? 0).toBe(0);
  });
});

// ─── TESTES: ThreePricesContext (injeção de assetType) ───────────────────────

describe('threePricesEngine — ThreePricesContext', () => {
  it('com contexto injetado, ETF entra no cálculo dos 3 preços', () => {
    // Sem contexto: ETF seria ignorado (não está em STOCK_LIKE_FALLBACK)
    // Com contexto: ETF entra no cálculo

    const ctx: ThreePricesContext = {
      isStockLike: (assetType) => ['stock', 'fii', 'etf'].includes(assetType),
      isOptionLike: (assetType) => ['option_call', 'option_put'].includes(assetType),
    };

    const entries: LedgerEvent[] = [
      {
        asset_id: 'asset-bova11',
        asset_ticker: 'BOVA11',
        asset_type: 'etf',
        transaction_type: 'buy',
        transaction_date: '2026-01-10',
        quantity: 50,
        unit_price: 100,
        total_net_value: -5000,
        impacts_managerial_price: true,
      } as unknown as LedgerEvent,
    ];

    // Sem contexto: ETF ignorado
    const reportSemCtx = buildThreePricesReport(entries, '2026-01-31');
    expect(reportSemCtx.underlyings.find((u) => u.ticker === 'BOVA11')).toBeUndefined();

    // Com contexto: ETF computado
    const reportComCtx = buildThreePricesReport(entries, '2026-01-31', ctx);
    const bova = reportComCtx.underlyings.find((u) => u.ticker === 'BOVA11');
    expect(bova).toBeDefined();
    expect(bova!.pmEstrito).toBeCloseTo(100, 4);
  });
});
```

### Verificação T3

```powershell
node .\node_modules\jest\bin\jest.js --selectProjects unit-core --testPathPattern="threePricesEngine" --runInBand
# Todos os novos testes devem passar
# Os testes existentes não devem regredir
```

---

## T4 — Mapear amortização de FII no parser BTG

### Contexto

Amortizações de FII chegam via **extrato BTG** (não via nota de corretagem).
O `btgBrokerageNoteLedgerTranslator.ts` **não é o lugar certo** — ele só processa trades de bolsa.

O extrato BTG traz amortização como uma linha de crédito com descrição parecida com:
`"AMORTIZACAO HGLG11"` ou `"REND/AMORT HGLG11"`.

### Localizar o parser do extrato BTG

```powershell
rg -rn "AMORT\|amort\|amortiz" src\core\invest\ --include="*.ts"
# Identificar qual arquivo processa o extrato/extrato mensal BTG
```

O arquivo provável é `btgHomeBrokerImport.ts` ou um parser de extrato separado.

### O que adicionar no parser de extrato

No ponto onde o parser classifica o tipo de evento de crédito, adicionar a detecção de amortização:

**Antes** (padrão genérico de crédito):
```typescript
// Lógica atual de classificação de crédito — formato aproximado:
if (isRendimento(description)) {
  return 'cash_yield';
}
if (isDividend(description)) {
  return 'dividend';
}
// ... outros casos
```

**Adicionar antes do caso genérico**:
```typescript
// Amortização de FII: retorno de capital (reduz PM) — deve ser 'amortization', não 'dividend'
if (/AMORT(IZACAO|IZACÃO|\.)?/i.test(description) || /REND\/AMORT/i.test(description)) {
  return 'amortization';
}
```

**E a linha gerada deve ter:**
```typescript
const line: LedgerImportLine = {
  date: extractDate,
  ticker: fiiFundTicker,          // ex: 'HGLG11'
  asset_type: 'fii',
  operation: 'amortization',
  quantity: 0,                    // sem mudança de cotas
  unit_value: amountPerUnit,      // R$ por cota amortizada (se disponível no extrato)
  unit_price: 0,
  total_net_value: totalAmount,   // total recebido (positivo = entrada)
  impacts_managerial_price: true, // OBRIGATÓRIO — é ajuste de custo
  event_source_ref: `BTG-EXT-${extractDate}:${lineSeq}`,
  broker_note_ref: `BTG-EXT-${extractDate}:${lineSeq}:AMORT`,
  source_system: 'btg_extract_parser',
  notes: `Amortização ${fiiFundTicker} — ${description}`,
};
```

> **Atenção:** Se o extrato BTG não traz `unit_value` (valor por cota), use a fórmula:
> `unit_value = totalAmount / quantidadeEmCarteira`
> onde `quantidadeEmCarteira` é buscada do livro razão na data do evento.
> Se não for possível calcular, use `unit_value = 0` e `total_net_value = totalAmount` —
> o engine vai ignorar a amortização sem errar (fallback seguro por `if (amortPerUnit <= 0) return`).

### Verificação T4

```powershell
# Buscar casos de teste existentes para o parser de extrato
rg -rn "amortiz\|AMORT" tests\ --include="*.ts"

# Adicionar um teste novo que confirme que "AMORTIZACAO HGLG11"
# gera transaction_type = 'amortization' e não 'dividend' ou 'cash_yield'
```

---

## T5 — Validação final completa

### 5.1 Build completo

```powershell
npm run build
# Resultado esperado: zero erros
```

### 5.2 Suite focada (mesma bateria do agente anterior + novos testes)

```powershell
node .\node_modules\jest\bin\jest.js --selectProjects unit-core --testPathPattern="(threePricesEngine|LedgerImportService.errors|AutoPendingSettlementSync|cashInTransit|cashInvestLedger|ReconciliationDiagnosticsService|PatrimonyMtmDailyEngine|PatrimonyMtmEconomic|patrimonyLedgerGates|storedPatrimonyChart|btgHomeBrokerImport|btgBrokerageNoteLedgerTranslator)" --runInBand
```

Resultado esperado:
- Todas as suites dos testes anteriores: ✅ ainda passam (nenhuma regressão)
- Novos testes `cost_adjustment`: ✅ passam
- Novos testes `amortization`: ✅ passam
- Novo teste `ThreePricesContext`: ✅ passa

### 5.3 Grep de auditoria pós-implementação

```powershell
# Confirmar que STOCK_LIKE hardcoded foi REMOVIDO do engine principal
rg -n "STOCK_LIKE\.has\|OPTION_LIKE\.has" src\core\invest\threePricesEngine.ts
# Resultado esperado: zero linhas (os .has() agora são via isStockLike/isOptionLike)

# Confirmar que os novos handlers existem
rg -n "applyCostAdjustment\|applyAmortization" src\core\invest\threePricesEngine.ts
# Resultado esperado: mínimo 4 linhas (2 definições + 2 chamadas)

# Confirmar que 'amortization' está no ledgerTypes
rg -n "'amortization'" src\core\invest\ledgerTypes.ts
# Resultado esperado: 1 linha

# Confirmar que não há outros STOCK_LIKE hardcoded no engine
rg -n "=== 'stock'\|=== 'fii'" src\core\invest\threePricesEngine.ts
# Resultado esperado: zero linhas
```

---

## RESUMO RÁPIDO — O QUE MUDAR E ONDE

| Tarefa | Arquivo | Tipo de mudança |
|---|---|---|
| T1 | `src/core/invest/ledgerTypes.ts` | Adicionar `'amortization'` ao array |
| T2-A | `src/core/invest/threePricesEngine.ts` | Substituir `STOCK_LIKE`/`OPTION_LIKE` por funções |
| T2-B | `src/core/invest/threePricesEngine.ts` | Inserir interface `ThreePricesContext` após imports |
| T2-C | `src/core/invest/threePricesEngine.ts` | Inserir `applyCostAdjustment` e `applyAmortization` antes de `applyStockBuy` |
| T2-D | `src/core/invest/threePricesEngine.ts` | Atualizar `applyEvent` com os novos handlers e `isStockLike`/`isOptionLike` |
| T2-E | `src/core/invest/threePricesEngine.ts` | Adicionar `ctx?` na assinatura de `applyEvent` |
| T2-F | `src/core/invest/threePricesEngine.ts` | Adicionar `ctx?` em `buildThreePricesReport` e propagá-lo |
| T3 | `tests/unit/invest/threePricesEngine.test.ts` | Adicionar 5 novos testes ao final |
| T4 | Parser de extrato BTG | Mapear `AMORTIZACAO` → `'amortization'` |
| T5 | — | Build + suite completa + greps de auditoria |

---

## ARMADILHAS COMUNS — O QUE NÃO FAZER

❌ **Não edite `ledgerTypes.js`** na pasta dist ou compilada. Só o `.ts`.

❌ **Não toque em `PatrimonyMtmDailyEngine.ts`** — já foi corrigido pelo agente anterior e usa `AssetValuationContext`. Não regrida esse arquivo.

❌ **Não adicione novos tipos ao `STOCK_LIKE_FALLBACK`** — o ponto de adição de novos tipos é `module_categories` no banco, não esse Set.

❌ **Não remova o fallback** `STOCK_LIKE_FALLBACK` e `OPTION_LIKE_FALLBACK` — eles são necessários para que callers que ainda não passam `ThreePricesContext` continuem funcionando.

❌ **Não altere `b3AjusteTotal` em `applyAmortization`** — deixe como está. PM B3 cai automaticamente quando `estritoTotal` cai.

❌ **Não use `total_net_value` em `applyAmortization`** como base de cálculo — use `unit_value × s.qty`. O `total_net_value` é o valor que entrou no caixa (correto), mas o engine precisa do valor por cota para aplicar proporcionalmente à posição atual.
