import type { PriceMode } from './priceModes';
import type { LedgerEvent } from './CustodyEngine';
import { inferUnderlyingTicker } from './assetClassifier';

const OPTION_TYPES = new Set(['option_call', 'option_put']);
const OPTION_TX = new Set([
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
]);

export type UnderlyingPriceState = {
  underlying: string;
  quantity: number;
  strictCostTotal: number;
  b3CostTotal: number;
  managerialCostTotal: number;
  optionAdjustmentManagerial: number;
};

export function emptyPriceState(underlying: string): UnderlyingPriceState {
  return {
    underlying,
    quantity: 0,
    strictCostTotal: 0,
    b3CostTotal: 0,
    managerialCostTotal: 0,
    optionAdjustmentManagerial: 0,
  };
}

export function isOptionLedgerEvent(e: LedgerEvent): boolean {
  const type = String(e.transaction_type);
  if (OPTION_TYPES.has(String(e.asset_type))) return true;
  if (OPTION_TX.has(type)) return true;
  if (type === 'buy' || type === 'sell') {
    return OPTION_TYPES.has(String(e.asset_type));
  }
  return false;
}

function isOptionEvent(e: LedgerEvent): boolean {
  return isOptionLedgerEvent(e);
}

/**
 * Aplica um lançamento ao estado de preço da ação mãe.
 * `netCash` = total_net_value (positivo = entra dinheiro na conta do investidor).
 */
export function applyLedgerToPriceState(
  state: UnderlyingPriceState,
  e: LedgerEvent,
  mode: PriceMode
): UnderlyingPriceState {
  const type = String(e.transaction_type);
  const qty = Number(e.quantity);
  const net = Number(e.total_net_value ?? 0);
  const underlying = inferUnderlyingTicker(
    String(e.asset_ticker),
    e.underlying_ticker ? String(e.underlying_ticker) : undefined
  );

  if (mode === 'b3' && type === 'option_exercise' && underlying === state.underlying) {
    state.b3CostTotal -= net;
    return state;
  }

  const isStock = !isOptionEvent(e);

  if (underlying !== state.underlying && isStock) {
    return state;
  }

  // —— Ações: custo clássico (qty + custo total) ——
  if (isStock && ['buy', 'opening_balance', 'bonus'].includes(type)) {
    const q = Math.abs(qty);
    const cost = q * Number(e.unit_price);
    state.quantity += q;
    state.strictCostTotal += cost;
    state.b3CostTotal += cost;
    state.managerialCostTotal += cost;
    return state;
  }

  if (isStock && ['sell', 'option_exercise'].includes(type)) {
    const q = Math.min(Math.abs(qty), state.quantity);
    if (state.quantity > 0) {
      const avgStrict = state.strictCostTotal / state.quantity;
      const avgB3 = state.b3CostTotal / state.quantity;
      const avgMgr = state.managerialCostTotal / state.quantity;
      state.strictCostTotal -= q * avgStrict;
      state.b3CostTotal -= q * avgB3;
      state.managerialCostTotal -= q * avgMgr;
      state.quantity -= q;
    }
    return state;
  }

  // —— Opções: só afetam PM conforme modo ——
  if (!isOptionEvent(e)) return state;

  if (mode === 'managerial') {
    // Ganho (net > 0) reduz custo gerencial; prejuízo (net < 0) aumenta.
    state.optionAdjustmentManagerial -= net;
    state.managerialCostTotal -= net;
  }

  // strict: opções não alteram PM do papel

  return state;
}

export function avgPrice(state: UnderlyingPriceState, mode: PriceMode): number {
  if (state.quantity <= 0) return 0;
  switch (mode) {
    case 'strict':
      return state.strictCostTotal / state.quantity;
    case 'b3':
      return state.b3CostTotal / state.quantity;
    case 'managerial':
      return state.managerialCostTotal / state.quantity;
    default:
      return 0;
  }
}

/** Rejoga livro-razão e devolve PM por underlying nos três modos. */
export function computePricesByUnderlying(
  entries: LedgerEvent[],
  mode: PriceMode = 'managerial'
): Map<string, UnderlyingPriceState> {
  const map = new Map<string, UnderlyingPriceState>();

  for (const e of entries) {
    const und = inferUnderlyingTicker(
      String(e.asset_ticker),
      e.underlying_ticker ? String(e.underlying_ticker) : undefined
    );
    let state = map.get(und);
    if (!state) state = emptyPriceState(und);
    applyLedgerToPriceState(state, e, mode);
    map.set(und, state);
  }

  return map;
}
