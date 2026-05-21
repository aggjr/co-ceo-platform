import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';

const POSITION_TX = new Set([
  'opening_balance',
  'buy',
  'sell',
  'bonus',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
  'split',
]);

function isCashAsset(assetType: string, ticker: string): boolean {
  return assetType === 'cash' || ticker.startsWith('CAIXA-');
}

function isFixedIncomeAsset(assetType: string, ticker: string): boolean {
  return (
    assetType === 'fixed_income' ||
    ticker.startsWith('TESOURO-') ||
    ticker.startsWith('CDB-') ||
    ticker.startsWith('LFT-') ||
    ticker.startsWith('TD-')
  );
}

/**
 * Calibração BTG (âncoras mensais) só quando o livro já tem custódia de RV/RF.
 * Livro vazio após purge → patrimônio econômico real (zero), sem curva fantasma.
 */
export function shouldUseBtgAnchorCalibration(entries: LedgerEvent[]): boolean {
  for (const e of entries) {
    const type = String(e.transaction_type || '');
    if (!POSITION_TX.has(type)) continue;
    const ticker = String(e.asset_ticker || '').toUpperCase();
    const assetType = String(e.asset_type || inferAssetType(ticker));
    if (isCashAsset(assetType, ticker)) continue;
    return true;
  }
  return false;
}

/** RF no motor MTM vem deste total (lançamentos RF no livro não entram no replay diário). */
export function fixedIncomeTotalFromLedger(entries: LedgerEvent[]): number {
  const sorted = [...entries].sort((a, b) =>
    String(a.transaction_date).localeCompare(String(b.transaction_date))
  );
  const qtyByAsset = new Map<string, number>();
  const priceByAsset = new Map<string, number>();

  for (const e of sorted) {
    const ticker = String(e.asset_ticker || '').toUpperCase();
    const assetType = String(e.asset_type || inferAssetType(ticker));
    if (!isFixedIncomeAsset(assetType, ticker)) continue;

    const id = String(e.asset_id || ticker);
    const type = String(e.transaction_type);
    const q = Number(e.quantity);
    const price = Number(e.unit_price ?? 0);

    if (type === 'opening_balance') {
      qtyByAsset.set(id, Math.abs(q));
      if (price > 0) priceByAsset.set(id, price);
      continue;
    }
    if (type === 'buy') {
      qtyByAsset.set(id, (qtyByAsset.get(id) ?? 0) + Math.abs(q));
      if (price > 0) priceByAsset.set(id, price);
      continue;
    }
    if (type === 'sell') {
      qtyByAsset.set(id, (qtyByAsset.get(id) ?? 0) - Math.abs(q));
    }
  }

  let total = 0;
  for (const [id, qty] of qtyByAsset) {
    if (Math.abs(qty) < 1e-9) continue;
    const price = priceByAsset.get(id) ?? 0;
    total += Math.abs(qty) * price;
  }
  return Math.round(total * 100) / 100;
}
