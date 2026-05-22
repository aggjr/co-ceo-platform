import { isFixedIncomeTicker, isOptionTicker } from './assetClassifier';
import type { LedgerTransactionType } from './ledgerTypes';
import {
  isTesouroDiretoTicker,
  normalizeTesouroLedgerQuantity,
} from './tesouroDirectLedger';

function isFixedIncomeAsset(assetType: string, ticker: string): boolean {
  return assetType === 'fixed_income' || isFixedIncomeTicker(ticker);
}

/** Ações, FIIs e opções podem ficar vendidas a descoberto; RF e caixa não. */
function allowsShortPosition(assetType: string, ticker: string): boolean {
  if (isFixedIncomeAsset(assetType, ticker)) return false;
  if (assetType === 'cash' || ticker.startsWith('CAIXA')) return false;
  return (
    assetType === 'stock' ||
    assetType === 'fii' ||
    assetType === 'option_call' ||
    assetType === 'option_put' ||
    isOptionTicker(ticker)
  );
}

export type LedgerEvent = {
  id?: string;
  transaction_date?: string;
  broker_note_ref?: string | null;
  notes?: string | null;
  asset_id: string;
  asset_ticker: string;
  asset_type: string;
  underlying_ticker?: string | null;
  transaction_type: LedgerTransactionType | string;
  quantity: number;
  unit_price: number;
  total_net_value: number;
  brokerage_fee?: number | null;
  b3_fees?: number | null;
  irrf_tax?: number | null;
  impacts_managerial_price?: boolean | number | null;
};

export type AssetCustodyState = {
  assetId: string;
  ticker: string;
  assetType: string;
  underlying: string;
  quantity: number;
  avgPrice: number;
};

export type CustodyRebuildResult = {
  assets: AssetCustodyState[];
  processedEntries: number;
};

type InternalState = {
  assetId: string;
  ticker: string;
  assetType: string;
  underlying: string;
  qty: number;
  totalCost: number;
};

function impactsPrice(flag: LedgerEvent['impacts_managerial_price']): boolean {
  if (flag === false || flag === 0) return false;
  return true;
}

function isBuyLike(type: string): boolean {
  return ['buy', 'put_buy', 'call_buy', 'opening_balance', 'bonus'].includes(type);
}

function isSellLike(type: string): boolean {
  return ['sell', 'put_sell', 'call_sell', 'option_exercise'].includes(type);
}

/** Converte lançamentos BTG de Tesouro (R$ com PU=1) para quantidade em títulos. */
function tesouroQtyAndPrice(
  e: LedgerEvent,
  state: InternalState
): { qty: number; price: number } {
  if (!isTesouroDiretoTicker(state.ticker)) {
    return { qty: Math.abs(Number(e.quantity)), price: Number(e.unit_price) };
  }
  const normalized = normalizeTesouroLedgerQuantity({
    quantity: Number(e.quantity),
    unit_price: Number(e.unit_price),
  });
  if (state.qty > 0 && state.totalCost > 0) {
    const avgPu = state.totalCost / state.qty;
    if (avgPu > 50) {
      return { qty: normalized.quantity, price: avgPu };
    }
  }
  return { qty: normalized.quantity, price: normalized.unit_price };
}

/**
 * Recalcula custódia (qty + preço médio gerencial) a partir do livro-razão ordenado.
 */
export function rebuildCustodyFromLedger(entries: LedgerEvent[]): CustodyRebuildResult {
  const states = new Map<string, InternalState>();

  const getState = (e: LedgerEvent): InternalState => {
    let s = states.get(e.asset_id);
    if (!s) {
      const underlying = (e.underlying_ticker || e.asset_ticker || '').toUpperCase();
      s = {
        assetId: e.asset_id,
        ticker: e.asset_ticker,
        assetType: e.asset_type,
        underlying,
        qty: 0,
        totalCost: 0,
      };
      states.set(e.asset_id, s);
    }
    return s;
  };

  for (const e of entries) {
    const type = String(e.transaction_type);
    const s = getState(e);

    /** Caixa: saldo = soma do extrato (R$), não preço médio × quantidade. */
    if (s.assetType === 'cash' || s.ticker.toUpperCase().startsWith('CAIXA')) {
      s.qty += Number(e.total_net_value ?? 0);
      continue;
    }

    if (!impactsPrice(e.impacts_managerial_price)) continue;

    if (type === 'split' && Number(e.quantity) > 0 && s.qty > 0) {
      s.qty = Number(e.quantity);
      continue;
    }

    if (isBuyLike(type)) {
      const { qty: buyQty, price } = tesouroQtyAndPrice(e, s);
      s.totalCost += buyQty * price;
      s.qty += buyQty;
      continue;
    }

    if (isSellLike(type)) {
      const { qty: sellQty, price } = tesouroQtyAndPrice(e, s);
      const isFi = isFixedIncomeAsset(s.assetType, s.ticker);

      if (s.qty > 0) {
        const used = Math.min(sellQty, s.qty);
        const avg = s.totalCost / s.qty;
        s.totalCost -= used * avg;
        s.qty -= used;
        const remainder = sellQty - used;
        if (remainder > 0 && !isFi) {
          s.qty -= remainder;
          s.totalCost += remainder * price;
        }
        if (s.qty === 0) s.totalCost = 0;
        continue;
      }

      // Renda fixa: venda sem estoque no livro não gera posição negativa (artefato de extrato).
      if (isFi) continue;

      s.qty -= sellQty;
      s.totalCost += sellQty * price;
    }
  }

  const assets: AssetCustodyState[] = [];
  for (const s of states.values()) {
    if (Math.abs(s.qty) < 1e-9) continue;
    if (s.qty < 0 && !allowsShortPosition(s.assetType, s.ticker)) continue;
    const absQty = Math.abs(s.qty);
    const quantity = Math.round(s.qty * 10000) / 10000;
    const avgPrice = Math.round((absQty > 0 ? s.totalCost / absQty : 0) * 10000) / 10000;
    assets.push({
      assetId: s.assetId,
      ticker: s.ticker,
      assetType: s.assetType,
      underlying: s.underlying,
      quantity,
      avgPrice,
    });
  }

  assets.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { assets, processedEntries: entries.length };
}
