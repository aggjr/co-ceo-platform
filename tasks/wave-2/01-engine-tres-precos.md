# Engine dos três preços (Estrito / B3 / Gerencial)

> **Onda**: 2 · **ID**: 01 · **Status**: ✅ pronta para execução (feita com o arquiteto)
> **Autor**: Augusto + Claude · **Executor**: Claude (coração matemático do INVEST)

## 1. Objetivo

Substituir `ManagerialPriceEngine.ts` por uma engine única (`threePricesEngine.ts`) que devolve `{estrito, b3, gerencial, qty, lotStart}` por ação mãe em um único passe, seguindo o modelo canônico de Augusto: sem FIFO/LIFO, três preços recalculados sobre o lote inteiro a cada entrada, reset total quando o lote zera.

## 2. Contexto

A engine atual (`ManagerialPriceEngine.ts`) tem dois bugs estruturais:

1. Reduz `managerialCostTotal` proporcional na venda da ação — viola "venda muda gerencial, mas por motivo certo (qty cai, prêmios constantes)".
2. Espera prêmio do exercício pré-calculado externamente (via `sumPutSellPremiumForExercise`, removido na Onda 1). A engine deve rastrear prêmio por ticker de opção e calcular sozinha o ajuste no exercício.

Fórmulas e matriz completa de transições em `memory/invest_three_prices_formulas.md` do arquiteto — não tem no repo, segue resumo em §4 desta task.

Regras de domínio em [.cursor/rules/co-ceo.mdc](../../.cursor/rules/co-ceo.mdc) e [docs/architecture/AI_HANDOFF.md](../../docs/architecture/AI_HANDOFF.md). Em especial: sem lotes, sem FIFO/LIFO, sem hardcode.

## 3. Arquivos a tocar

- `src/core/invest/threePricesEngine.ts` (criar) — engine nova
- `src/core/invest/portfolioThreePrices.ts` (modificar) — virar fachada fina sobre a engine
- `src/core/invest/ManagerialPriceEngine.ts` (apagar) — substituído
- `tests/unit/invest/ManagerialPriceEngine.test.ts` (apagar) — testa modelo antigo
- `tests/unit/invest/threePricesEngine.test.ts` (criar) — cobre matriz completa
- `tests/unit/invest/portfolioThreePrices.test.ts` (verificar/atualizar) — pode quebrar com mudança da engine

## 4. Contrato

### Estado por ação mãe (underlying), durante um lote aberto

```ts
type UnderlyingState = {
  underlying: string;
  qty: number;                     // ações em carteira (>= 0)
  estritoTotal: number;            // R$ no estoque (custo bruto + emolumentos/taxas/IRRF)
  b3AjusteTotal: number;           // R$ com sinal (sobe em PUT vendida exercida; desce em CALL comprada exercida)
  premioOpcoesPeriodo: number;     // R$ líquido (vendas de opção − compras de opção); nunca cai na venda da ação
  lotStartDate: string | null;     // primeira compra que tirou qty de 0
  optionSeries: Map<string, OptionSeriesState>;
};

type OptionSeriesState = {
  ticker: string;
  qtyAtual: number;                // positivo = comprado; negativo = vendido
  premioLiquido: number;           // R$ líquido (vendas − compras) ainda não consumido por exercício
};
```

### Fórmulas (todos dividem por `qty` atual)

```
PM Estrito    = estritoTotal / qty
PM B3         = (estritoTotal − b3AjusteTotal) / qty
PM Gerencial  = (estritoTotal − premioOpcoesPeriodo) / qty
```

### Matriz de transições

| Evento | qty | estritoTotal | b3AjusteTotal | premioOpcoesPeriodo | optionSeries |
|---|---|---|---|---|---|
| `buy` (stock/fii) | `+q` | `+ |total_net_value|` (custo bruto + custos da operação) | — | — | — |
| `sell` (stock/fii) | `−q` | `−proporcional` | `−proporcional` | — | — |
| `opening_balance`, `bonus` (stock/fii) | `+q` | `+ q × unit_price` | — | — | — |
| `split` (stock/fii) | qty := `quantity` do evento | recalcula PM mantendo custo total | recalcula proporcional | — | — |
| `put_sell` / `call_sell` (qty negativa, net positivo) | — | — | — | `+net` | `qtyAtual -= |q|`; `premioLiquido += net` |
| `put_buy` / `call_buy` (qty positiva, net negativo) | — | — | — | `+net` (vira `−|net|`) | `qtyAtual += q`; `premioLiquido += net` |
| `option_exercise` + qtyAtual da série < 0 + asset_type=`option_put` → **PUT vendida exercida** | `+X` | `+ X × unit_price + custos` | `+ prêmio_alocado` | — | qtyAtual `+=X` (chega mais perto de 0); premioLiquido `−= prêmio_alocado` |
| `option_exercise` + qtyAtual da série > 0 + asset_type=`option_call` → **CALL comprada exercida** | `+X` | `+ X × unit_price + custos` | `− |prêmio_alocado|` (prêmio_alocado é negativo na série) | — | qtyAtual `−=X`; premioLiquido `−= prêmio_alocado` |
| `option_exercise` + qtyAtual > 0 + put → **PUT comprada exercida** (saída forçada) | `−X` | `−proporcional` | `−proporcional` | — | qtyAtual `−=X` |
| `option_exercise` + qtyAtual < 0 + call → **CALL vendida exercida** (saída forçada) | `−X` | `−proporcional` | `−proporcional` | — | qtyAtual `+=X` |
| qty atinge 0 (final de venda ou exercício de saída) | reset | reset | reset | reset | reset (todas as séries) |

### Alocação proporcional do prêmio no exercício

```
prêmio_alocado = (X / |qtyAtualSerie_antes_do_exercício|) × premioLiquidoSerie
```

Onde `X` é a quantidade exercida no evento `option_exercise`. O sinal de `prêmio_alocado` segue o sinal de `premioLiquidoSerie`.

### Outras transações

- `dividend`, `jcp`, `cash_yield`, `securities_lending`, `capital_deposit`, `capital_withdrawal`, `penalty_b3`, `fee`, `revaluation`, `pending_settlement`: a engine **ignora**. Não afetam nenhum dos 3 preços.

### Eventos com `impacts_managerial_price: false`

Ignorados pela engine **somente** quando o lançamento é um marcador contábil (notas do tipo "B3 — prêmio PUT no exercício" gerados pelo `mapBrokerOrderToLedger` antigo). Esses lançamentos antigos podem coexistir no banco. Na engine nova, o `option_exercise` que de fato dispara o ajuste é o que tem `impacts_managerial_price: true` (default). Use o flag como filtro.

### API pública da engine

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

Eventos chegam em qualquer ordem; a engine ordena por `transaction_date` + `id` antes de processar.

## 5. Critério de aceite

```bash
npx tsc --noEmit
npx jest tests/unit/invest/threePricesEngine.test.ts
npx jest tests/unit/invest        # toda a suite do INVEST
```

Todos verdes. A suite completa (`npx jest`) também precisa ficar verde.

### Casos de teste obrigatórios (`threePricesEngine.test.ts`)

1. Compra simples — PM Estrito = PM B3 = PM Gerencial = preço × qty + custos / qty.
2. Duas compras em datas diferentes — média ponderada.
3. Compra + venda parcial — Estrito e B3 constantes; Gerencial constante (não há prêmio no período).
4. **Caso A do arquiteto**: vendo PUT por R$ 10 + PUT exercida → 1000 ações ao strike R$ 1. PM B3 = 0,99; PM Gerencial = 0,99.
5. **Caso B do arquiteto**: compro CALL por R$ 10 + CALL exercida → 1000 ações ao strike R$ 1. PM B3 = 1,01; PM Gerencial = 1,01.
6. **Caso C parcial**: vendi 1000 PUTs (+1000), recomprei 200 (−300), 600 exercidas. Prêmio alocado = (600/800)×700 = 525. Verificar que `premioLiquidoSerie` remanescente = 175 para as 200 abertas.
7. Vendi 3 PUTs, 2 exercidas, 1 expira — todas as 3 abateram do Gerencial (premioOpcoesPeriodo); só o prêmio das 2 exercidas abateu do B3.
8. Vendi 5 CALLs, 1 exercida, 4 expiram — todas as 5 abateram do Gerencial; nenhuma abateu do B3 (CALL vendida exercida é saída, não ajusta B3 do remanescente).
9. Lote zera por venda total → próxima compra começa do zero (PM = preço da nova compra).
10. Reset não vaza estado por opção (séries da ação mãe são limpas no reset).

## 6. Pegadinhas

- **Sinais**: `quantity` da opção vendida no ledger vem **negativo** (`call_sell` com qty=-900). `total_net_value` da venda vem positivo (entra dinheiro). Trate com `Math.abs(qty)` e usar `total_net_value` literal.
- **`total_net_value` para compras de ação** vem **negativo** (sai dinheiro). Use `−total_net_value` como custo positivo, ou `Math.abs`.
- **`option_exercise`** hoje pode ter `total_net_value` qualquer no banco (legado). A engine **ignora** esse campo — usa só `unit_price` (strike) e o histórico de optionSeries.
- **`split`** muda qty mas preserva custo total. A engine atual já trata isso — preservar o comportamento.
- **Eventos fora de `[lotStartDate, hoje]`** não devem contar no Gerencial. O reset por lote já garante, mas atenção a ordering.
- **`asset_type` pode vir vazio** em lançamentos antigos. Use `inferAssetType(ticker)` como fallback.

## 7. O que NÃO fazer

- Não criar conceito de "lote" (multiplicador, contract_size).
- Não introduzir FIFO/LIFO em nenhum cálculo.
- Não hardcodar strike, prêmio, nem catálogo de opções.
- Não tocar em `CustodyEngine.ts` — quantidades vêm de lá, esta task é só sobre PM.
- Não tocar em `LedgerImportService.ts` — schema de import não muda.
- Não criar nova migration de banco.
- Não tentar resolver "explodir o lote" (UI) — tema da Onda 4.

## 8. Saída esperada

- Branch: `feat/invest-three-prices-engine`
- Commit(s): `refactor(invest): engine única dos três preços (Estrito/B3/Gerencial)` + corpo explicando bug do modelo antigo + matriz nova.
- PR referenciando esta task spec.

## 9. Notas para o revisor (arquiteto)

- Confirmar que os Casos A, B, C numéricos batem exatamente.
- Confirmar tratamento dos exercícios de PUT comprada e CALL vendida (saídas forçadas) — não havia caso explícito nas regras, mas a regra geral "venda não muda PM B3/Estrito do remanescente" se aplica.
- Confirmar que `dividend`, `jcp`, etc. estão corretamente ignorados (não afetam os 3 PMs).
