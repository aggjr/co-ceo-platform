import type { LedgerEvent } from './CustodyEngine';
import { AUTO_D2_REF_PREFIX } from './AutoPendingSettlementSync';
import { isCashInvestTicker, settledCashBalanceFromLedger } from './cashInvestLedger';
import {
  cashSettlementDate,
  cashSettlementRuleLabel,
  defersCashSettlement,
  resolveAssetTypeForSettlement,
} from './settlementCalendar';

export type CashInTransitLine = {
  tradeDate: string;
  settleDate: string;
  amount: number;
  ticker: string;
  transactionType: string;
  assetType: string;
  rule: string;
  notes: string;
  brokerNoteRef: string | null;
  ledgerEntryId: string | null;
  source: 'pending_settlement' | 'trade_forecast';
};

export type CashInTransitSummary = {
  asOfDate: string;
  /** Saldo já na conta (extrato / livro, sem previsões abertas). */
  settledCashBalance: number;
  /** Soma líquida do que ainda não liquidou na conta. */
  inTransitNet: number;
  receivables: number;
  payables: number;
  /** Saldo + trânsito (visão de caixa disponível + a receber/pagar). */
  cashIncludingTransit: number;
  lines: CashInTransitLine[];
};

function tradeCashFlowForTransit(txType: string, net: number): number {
  const abs = Math.abs(net);
  if (abs < 0.005) return 0;
  if (txType === 'buy' || txType === 'put_buy' || txType === 'call_buy') return -abs;
  if (txType === 'sell' || txType === 'put_sell' || txType === 'call_sell') return abs;
  return net;
}

function isPendingSettlement(e: LedgerEvent): boolean {
  return String(e.transaction_type) === 'pending_settlement';
}

function pendingBaseRef(ref: string): string | null {
  if (!ref.startsWith(AUTO_D2_REF_PREFIX)) return null;
  if (ref.endsWith(':CLEAR')) return ref.slice(0, -':CLEAR'.length);
  return ref;
}

function collectOpenPendingLines(
  entries: LedgerEvent[],
  asOfDate: string
): CashInTransitLine[] {
  const byRef = new Map<
    string,
    { amount: number; tradeDate: string; notes: string; ledgerEntryId: string | null }
  >();

  for (const e of entries) {
    if (!isCashInvestTicker(String(e.asset_ticker))) continue;
    if (!isPendingSettlement(e)) continue;
    const ref = String(e.broker_note_ref || '');
    const base = pendingBaseRef(ref);
    if (!base) continue;

    if (ref.endsWith(':CLEAR')) {
      byRef.delete(base);
      continue;
    }

    const tradeDate = String(e.transaction_date || '').slice(0, 10);
    if (tradeDate && tradeDate > asOfDate) continue;

    const prev = byRef.get(base);
    const net = Number(e.total_net_value ?? 0);
    byRef.set(base, {
      amount: (prev?.amount ?? 0) + net,
      tradeDate: prev?.tradeDate || tradeDate,
      notes: String(e.notes || prev?.notes || ''),
      ledgerEntryId: base.slice(AUTO_D2_REF_PREFIX.length) || null,
    });
  }

  const tradeById = new Map<string, LedgerEvent>();
  for (const e of entries) {
    if (e.id) tradeById.set(String(e.id), e);
  }

  const lines: CashInTransitLine[] = [];
  for (const [ref, row] of byRef) {
    if (Math.abs(row.amount) < 0.005) continue;

    const trade = row.ledgerEntryId ? tradeById.get(row.ledgerEntryId) : undefined;
    const ticker = trade ? String(trade.asset_ticker) : '—';
    const assetType = trade
      ? resolveAssetTypeForSettlement(ticker, String(trade.asset_type))
      : 'cash';
    const txType = trade ? String(trade.transaction_type) : 'pending_settlement';
    const settleDate = trade
      ? cashSettlementDate(
          String(trade.transaction_date).slice(0, 10),
          assetType,
          txType,
          ticker
        )
      : row.tradeDate;

    if (settleDate <= asOfDate) continue;

    lines.push({
      tradeDate: trade ? String(trade.transaction_date).slice(0, 10) : row.tradeDate,
      settleDate,
      amount: Math.round(row.amount * 100) / 100,
      ticker,
      transactionType: txType,
      assetType,
      rule: trade
        ? cashSettlementRuleLabel(assetType, txType, ticker)
        : 'Previsão no livro',
      notes: row.notes || `Ref ${ref}`,
      brokerNoteRef: ref,
      ledgerEntryId: row.ledgerEntryId,
      source: 'pending_settlement',
    });
  }
  return lines;
}

function collectTradeForecastLines(
  entries: LedgerEvent[],
  asOfDate: string,
  coveredTradeIds: Set<string>
): CashInTransitLine[] {
  const lines: CashInTransitLine[] = [];

  for (const e of entries) {
    const ticker = String(e.asset_ticker || '').toUpperCase();
    if (isCashInvestTicker(ticker)) continue;

    const assetType = resolveAssetTypeForSettlement(ticker, String(e.asset_type));
    const txType = String(e.transaction_type);
    if (!defersCashSettlement(assetType, txType, ticker)) continue;

    const tradeDate = String(e.transaction_date || '').slice(0, 10);
    if (!tradeDate || tradeDate > asOfDate) continue;

    const entryKey = e.id
      ? String(e.id)
      : `${ticker}:${tradeDate}:${txType}:${String(e.broker_note_ref || '')}`;
    if (coveredTradeIds.has(entryKey)) continue;

    const settleDate = cashSettlementDate(tradeDate, assetType, txType, ticker);
    if (settleDate <= asOfDate) continue;

    const net = Number(e.total_net_value ?? 0);
    if (Math.abs(net) < 0.005) continue;

    lines.push({
      tradeDate,
      settleDate,
      amount: Math.round(tradeCashFlowForTransit(txType, net) * 100) / 100,
      ticker,
      transactionType: txType,
      assetType,
      rule: cashSettlementRuleLabel(assetType, txType, ticker),
      notes: `Previsão — conferir extrato BTG em ${settleDate}`,
      brokerNoteRef: e.broker_note_ref ? String(e.broker_note_ref) : null,
      ledgerEntryId: e.id ? String(e.id) : entryKey,
      source: 'trade_forecast',
    });
  }

  return lines;
}

export function buildCashInTransitSummary(
  entries: LedgerEvent[] | null | undefined,
  asOfDate?: string
): CashInTransitSummary {
  const asOf = (asOfDate || new Date().toISOString()).slice(0, 10);
  const list = entries || [];

  const pendingLines = collectOpenPendingLines(list, asOf);
  const covered = new Set(
    pendingLines.map((l) => l.ledgerEntryId).filter((id): id is string => Boolean(id))
  );
  const forecastLines = collectTradeForecastLines(list, asOf, covered);
  const lines = [...pendingLines, ...forecastLines].sort((a, b) =>
    a.settleDate.localeCompare(b.settleDate) || a.tradeDate.localeCompare(b.tradeDate)
  );

  let receivables = 0;
  let payables = 0;
  for (const l of lines) {
    if (l.amount > 0) receivables += l.amount;
    else payables += l.amount;
  }
  receivables = Math.round(receivables * 100) / 100;
  payables = Math.round(payables * 100) / 100;
  const inTransitNet = Math.round((receivables + payables) * 100) / 100;
  const settledCashBalance = settledCashBalanceFromLedger(list, asOf);

  return {
    asOfDate: asOf,
    settledCashBalance,
    inTransitNet,
    receivables,
    payables,
    cashIncludingTransit: Math.round((settledCashBalance + inTransitNet) * 100) / 100,
    lines,
  };
}
