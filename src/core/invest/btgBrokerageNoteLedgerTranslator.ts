/**
 * Traduz notas de corretagem BTG (parser) → lançamentos do livro razão.
 * Usa mapBrokerOrderToLedger para opções/exercícios; locação → securities_lending.
 */
import { inferAssetType } from './assetClassifier';
import { mapBrokerOrderToLedger } from './brokerOrderMapper';
import type { BtgBrokerageNote, BtgBrokerageNoteTrade } from './btgBrokerageNoteParser';
import type { LedgerImportLine } from './ledgerTypes';

export const BTG_NOTE_LEDGER_REF_PREFIX = 'BTG-NOTA';

type NoteFees = {
  settlement: number;
  registration: number;
  emoluments: number;
  irrf: number;
};

function noteFees(note: BtgBrokerageNote): NoteFees {
  return {
    settlement: Math.abs(Number(note.settlementTax ?? 0)),
    registration: Math.abs(Number(note.registrationTax ?? 0)),
    emoluments: Math.abs(Number(note.emoluments ?? 0)),
    irrf: Math.abs(Number(note.irrf ?? 0)),
  };
}

function feeShareForTrade(
  trade: BtgBrokerageNoteTrade,
  trades: BtgBrokerageNoteTrade[],
  fees: NoteFees
): Pick<LedgerImportLine, 'brokerage_fee' | 'b3_fees' | 'irrf_tax'> {
  const totalGross = trades.reduce((s, t) => s + Math.abs(Number(t.grossValue) || 0), 0);
  if (totalGross <= 0) {
    return {
      brokerage_fee: 0,
      b3_fees: fees.settlement + fees.registration + fees.emoluments,
      irrf_tax: fees.irrf,
    };
  }
  const frac = Math.abs(Number(trade.grossValue) || 0) / totalGross;
  return {
    brokerage_fee: 0,
    b3_fees: Math.round((fees.settlement + fees.registration + fees.emoluments) * frac * 100) / 100,
    irrf_tax: Math.round(fees.irrf * frac * 100) / 100,
  };
}

function applyFeesToLine(
  line: LedgerImportLine,
  share: Pick<LedgerImportLine, 'brokerage_fee' | 'b3_fees' | 'irrf_tax'>,
  trade: BtgBrokerageNoteTrade
): void {
  line.brokerage_fee = share.brokerage_fee ?? 0;
  line.b3_fees = share.b3_fees ?? 0;
  line.irrf_tax = share.irrf_tax ?? 0;
  const gross = Math.abs(Number(trade.grossValue) || 0);
  const fees =
    Math.abs(line.brokerage_fee ?? 0) +
    Math.abs(line.b3_fees ?? 0) +
    Math.abs(line.irrf_tax ?? 0);
  const isOutflow = ['buy', 'put_buy', 'call_buy', 'opening_balance'].includes(line.operation);
  if (line.operation === 'securities_lending') {
    line.total_net_value = gross;
    return;
  }
  if (isOutflow) line.total_net_value = -(gross + fees);
  else line.total_net_value = gross - fees;
}

function loanToLedger(
  note: BtgBrokerageNote,
  trade: BtgBrokerageNoteTrade,
  ref: string,
  share: Pick<LedgerImportLine, 'brokerage_fee' | 'b3_fees' | 'irrf_tax'>
): LedgerImportLine {
  const ticker = (trade.underlyingStock || trade.ticker || '').toUpperCase();
  const line: LedgerImportLine = {
    date: note.pregaoDate,
    ticker,
    asset_type: inferAssetType(ticker),
    underlying_ticker: ticker,
    operation: 'securities_lending',
    quantity: Math.abs(Number(trade.quantity) || 0),
    unit_price: Number(trade.unitPrice) || 0,
    total_net_value: Math.abs(Number(trade.grossValue) || 0),
    broker_note_ref: ref,
    notes: `Locação BTC — ${trade.specification || trade.ticker}`,
    impacts_managerial_price: false,
  };
  applyFeesToLine(line, share, trade);
  return line;
}

function tradeToLedger(
  note: BtgBrokerageNote,
  trade: BtgBrokerageNoteTrade,
  lineNo: number
): LedgerImportLine[] {
  const ref = `${BTG_NOTE_LEDGER_REF_PREFIX}-${note.noteNumber}#${note.pregaoDate}#${lineNo}`;
  const fees = noteFees(note);
  const share = feeShareForTrade(trade, note.trades, fees);

  if (note.category === 'LOAN') {
    return [loanToLedger(note, trade, ref, share)];
  }

  const mapped = mapBrokerOrderToLedger({
    ticker: trade.ticker,
    direction: trade.side,
    quantity: Math.abs(Number(trade.quantity) || 0),
    avgPrice: Number(trade.unitPrice) || 0,
    date: note.pregaoDate,
    broker_note_ref: ref,
  });

  if (!mapped.length) return [];

  for (const line of mapped) {
    if (trade.isExercise && line.operation === 'buy') {
      line.option_strike = Number(trade.unitPrice) || undefined;
      line.notes = line.notes || `Exercício — ${trade.ticker}`;
    }
    applyFeesToLine(line, share, trade);
  }
  return mapped;
}

/** Converte notas deduplicadas em linhas para LedgerImportService.importEntriesOnly. */
export function brokerageNotesToLedgerLines(notes: BtgBrokerageNote[]): LedgerImportLine[] {
  const lines: LedgerImportLine[] = [];
  for (const note of notes) {
    if (!note.trades.length) continue;
    note.trades.forEach((trade, idx) => {
      lines.push(...tradeToLedger(note, trade, idx + 1));
    });
  }
  return lines;
}
