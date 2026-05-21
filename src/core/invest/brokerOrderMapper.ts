import { inferAssetType, inferUnderlyingTicker } from './assetClassifier';
import type { LedgerImportLine } from './ledgerTypes';

export type MapBrokerOrderOptions = {
  /** Prêmio líquido já recebido na PUT vendida (ajuste B3 só no exercício). */
  putPremiumNetForB3?: number;
  /** Prêmio líquido já pago na CALL comprada (ajuste B3: PM ≈ strike + prêmio/qty). */
  callPremiumNetForB3?: number;
};

export type BrokerOrderRow = {
  ticker: string;
  /** C = compra, V = venda (lado do investidor na ordem). */
  direction: 'C' | 'V';
  /**
   * Quantidade executada em **ações** (como BTG / myProfit exibem).
   * Ex.: 300 na ordem = 300 ações do underlying, não 300 contratos × 100.
   */
  quantity: number;
  avgPrice: number;
  /** ISO `YYYY-MM-DD` ou datetime. */
  date: string;
  broker_note_ref?: string;
};

/** Remove sufixo B3 de exercício/atribuição (`E` ou `F`). */
export function stripOptionExerciseSuffix(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[EF]$/, '');
}

/**
 * Exercício / atribuição no vencimento: ticker costuma terminar em `E` ou `F`
 * e o preço médio ≈ strike (não prêmio de centavos).
 */
export function isLikelyOptionExercise(ticker: string, avgPrice: number): boolean {
  const t = ticker.trim().toUpperCase();
  if (!/[EF]$/.test(t)) return false;
  if (avgPrice < 5) return false;
  const base = stripOptionExerciseSuffix(t);
  const kind = inferAssetType(base);
  return kind === 'option_call' || kind === 'option_put';
}

function parseDateOnly(isoOrBr: string): string {
  const s = isoOrBr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0, 10);
}

function optionOperation(
  direction: 'C' | 'V',
  assetType: string
): LedgerImportLine['operation'] {
  const isCall = assetType === 'option_call';
  if (direction === 'V') return isCall ? 'call_sell' : 'put_sell';
  return isCall ? 'call_buy' : 'put_buy';
}

/**
 * Converte linha do histórico de ordens (BTG / Profit) em lançamento(s) do livro-razão.
 *
 * - Prêmio (V/C em opção): `put_*` / `call_*` → ajusta **preço gerencial** da mãe.
 * - Exercício (`…E` + strike): `buy`/`sell` no **papel** (BBAS3, ITUB4, PRIO3…).
 */
export function mapBrokerOrderToLedger(
  row: BrokerOrderRow,
  options?: MapBrokerOrderOptions
): LedgerImportLine[] {
  const ticker = row.ticker.trim().toUpperCase();
  const date = parseDateOnly(row.date);
  const qtyShares = Math.abs(Number(row.quantity));
  const price = Number(row.avgPrice);
  const optionTicker = stripOptionExerciseSuffix(ticker);
  const underlying = inferUnderlyingTicker(optionTicker);

  if (isLikelyOptionExercise(ticker, price)) {
    const isBuy = row.direction === 'C';
    const gross = qtyShares * price;
    const lines: LedgerImportLine[] = [
      {
        date,
        ticker: underlying,
        asset_type: 'stock',
        underlying_ticker: underlying,
        operation: isBuy ? 'buy' : 'sell',
        quantity: qtyShares,
        unit_price: price,
        total_net_value: isBuy ? -gross : gross,
        broker_note_ref: row.broker_note_ref,
        notes: `Exercício/atribuição — ${ticker}`,
        impacts_managerial_price: true,
      },
    ];

    const putPremium = options?.putPremiumNetForB3;
    if (
      isBuy &&
      inferAssetType(optionTicker) === 'option_put' &&
      putPremium != null &&
      putPremium !== 0
    ) {
      lines.push({
        date,
        ticker: optionTicker,
        asset_type: 'option_put',
        underlying_ticker: underlying,
        operation: 'option_exercise',
        quantity: qtyShares,
        unit_price: 0,
        total_net_value: putPremium,
        broker_note_ref: row.broker_note_ref
          ? `${row.broker_note_ref}#b3-put`
          : undefined,
        notes: `B3 — prêmio PUT no exercício (${ticker})`,
        impacts_managerial_price: false,
      });
    }

    const callPremium = options?.callPremiumNetForB3;
    if (
      isBuy &&
      inferAssetType(optionTicker) === 'option_call' &&
      callPremium != null &&
      callPremium !== 0
    ) {
      const paid = Math.abs(callPremium);
      lines.push({
        date,
        ticker: optionTicker,
        asset_type: 'option_call',
        underlying_ticker: underlying,
        operation: 'option_exercise',
        quantity: qtyShares,
        unit_price: price,
        total_net_value: -paid,
        broker_note_ref: row.broker_note_ref
          ? `${row.broker_note_ref}#b3-call`
          : undefined,
        notes: `B3 — prêmio CALL no exercício (${ticker})`,
        impacts_managerial_price: false,
      });
    }

    return lines;
  }

  const assetType = inferAssetType(ticker);
  if (assetType !== 'option_call' && assetType !== 'option_put') {
    return [];
  }

  const operation = optionOperation(row.direction, assetType);
  const premiumTotal = qtyShares * price;
  const net = row.direction === 'V' ? premiumTotal : -premiumTotal;

  return [
    {
      date,
      ticker,
      asset_type: assetType,
      underlying_ticker: underlying,
      operation,
      quantity: qtyShares,
      unit_price: price,
      total_net_value: Math.round(net * 100) / 100,
      broker_note_ref: row.broker_note_ref,
      notes: `Ordem ${row.direction} — ${ticker}`,
      impacts_managerial_price: true,
    },
  ];
}
