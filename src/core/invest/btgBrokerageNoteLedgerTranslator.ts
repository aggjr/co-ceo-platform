/**
 * Traduz notas de corretagem no padrao B3 (parser BTG) → lançamentos do livro razão.
 * Formato do documento e B3; a corretora (BTG) aparece no extrato financeiro.
 *
 * Regra unica (toda nota / todo item):
 *   - operacao: valor bruto no patrimonio;
 *   - fee: cada taxa/emolumento/IRRF em linha propria no mesmo business_event;
 *   - import mensal: pending = bruto(s) − taxas → casa com LIQ BOLSA do extrato.
 */
import { inferAssetType } from './assetClassifier';
import { mapBrokerOrderToLedger } from './brokerOrderMapper';
import { cashSettlementDate } from './settlementCalendar';
import {
  aggregateNoteFees,
  type BtgBrokerageNote,
  type BtgBrokerageNoteTrade,
} from './btgBrokerageNoteParser';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';

/** Prefixo canonico de perna individual (idempotencia). */
export const B3_NOTE_LEDGER_REF_PREFIX = 'B3-NOTA';
/** Prefixo canonico do header business_events (1 header por nota B3). */
export const B3_NOTE_EVENT_REF_PREFIX = 'B3-NOTA';
/** @deprecated use B3_NOTE_* — alias legado */
export const BTG_NOTE_LEDGER_REF_PREFIX = B3_NOTE_LEDGER_REF_PREFIX;
/** @deprecated use B3_NOTE_* — alias legado */
export const BTG_NOTE_EVENT_REF_PREFIX = B3_NOTE_EVENT_REF_PREFIX;

/**
 * Chave canonica do header business_events para uma nota BTG. Todas as
 * pernas da mesma nota carregam o MESMO event_source_ref e caem no mesmo
 * business_events.id via BusinessEventRegistry.ensureByRef.
 *
 * `broker_note_ref` (line-level) continua diferenciado por trade para
 * idempotencia da perna individual.
 */
function eventSourceRefForNote(note: BtgBrokerageNote): string {
  return `${B3_NOTE_EVENT_REF_PREFIX}-${note.noteNumber}`;
}

type NoteFees = {
  brokerage: number;
  settlement: number;
  registration: number;
  emoluments: number;
  bovespa: number;
  irrf: number;
};

function noteFees(note: BtgBrokerageNote): NoteFees {
  const a = aggregateNoteFees(note);
  return {
    brokerage: a.brokerage,
    settlement: a.settlement,
    registration: a.registration,
    emoluments: a.emoluments,
    bovespa: a.bovespa,
    irrf: a.irrf,
  };
}

function feeShareForTrade(
  trade: BtgBrokerageNoteTrade,
  trades: BtgBrokerageNoteTrade[],
  fees: NoteFees
): Pick<LedgerImportLine, 'brokerage_fee' | 'b3_fees' | 'irrf_tax'> {
  const totalGross = trades.reduce((s, t) => s + Math.abs(Number(t.grossValue) || 0), 0);
  const b3Pool = fees.settlement + fees.registration + fees.emoluments + fees.bovespa;
  if (totalGross <= 0) {
    return {
      brokerage_fee: fees.brokerage,
      b3_fees: b3Pool,
      irrf_tax: fees.irrf,
    };
  }
  const frac = Math.abs(Number(trade.grossValue) || 0) / totalGross;
  return {
    brokerage_fee: Math.round(fees.brokerage * frac * 100) / 100,
    b3_fees: Math.round(b3Pool * frac * 100) / 100,
    irrf_tax: Math.round(fees.irrf * frac * 100) / 100,
  };
}

/** Patrimonio na nota = valor bruto da operacao; taxas viram linhas fee separadas. */
function applyFeesToLine(
  line: LedgerImportLine,
  share: Pick<LedgerImportLine, 'brokerage_fee' | 'b3_fees' | 'irrf_tax'>,
  trade: BtgBrokerageNoteTrade
): void {
  line.brokerage_fee = share.brokerage_fee ?? 0;
  line.b3_fees = share.b3_fees ?? 0;
  line.irrf_tax = share.irrf_tax ?? 0;
  const gross = Math.abs(Number(trade.grossValue) || 0);
  const isOutflow = ['buy', 'put_buy', 'call_buy', 'opening_balance'].includes(line.operation);
  if (line.operation === 'securities_lending') {
    line.total_net_value = gross;
    return;
  }
  if (isOutflow) line.total_net_value = -gross;
  else line.total_net_value = gross;
}

type NoteFeeSpec = {
  suffix: string;
  label: string;
  amount: number;
};

function allocateFeeAmount(
  total: number,
  trades: BtgBrokerageNoteTrade[],
  tradeIndex: number
): number {
  if (Math.abs(total) < 0.005) return 0;
  const weights = trades.map((t) => Math.abs(Number(t.grossValue) || 0));
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) {
    if (tradeIndex === 0) return Math.round(total * 100) / 100;
    return 0;
  }
  if (tradeIndex === trades.length - 1) {
    let allocated = 0;
    for (let i = 0; i < tradeIndex; i += 1) {
      allocated += Math.round(total * (weights[i]! / sumW) * 100) / 100;
    }
    return Math.round((total - allocated) * 100) / 100;
  }
  return Math.round(total * (weights[tradeIndex]! / sumW) * 100) / 100;
}

function tradeFeeSpecs(
  note: BtgBrokerageNote,
  tradeIndex: number
): NoteFeeSpec[] {
  const f = noteFees(note);
  const specs: NoteFeeSpec[] = [
    {
      suffix: 'BROKERAGE',
      label: 'Corretagem',
      amount: allocateFeeAmount(f.brokerage, note.trades, tradeIndex),
    },
    {
      suffix: 'SETTLE',
      label: 'Taxa de liquidacao/CCP',
      amount: allocateFeeAmount(f.settlement, note.trades, tradeIndex),
    },
    {
      suffix: 'REG',
      label: 'Taxa de registro',
      amount: allocateFeeAmount(f.registration, note.trades, tradeIndex),
    },
    {
      suffix: 'EMOL',
      label: 'Emolumentos',
      amount: allocateFeeAmount(f.emoluments, note.trades, tradeIndex),
    },
    {
      suffix: 'BOVESPA',
      label: 'Total Bovespa / Soma',
      amount: allocateFeeAmount(f.bovespa, note.trades, tradeIndex),
    },
    {
      suffix: 'IRRF',
      label: 'IRRF',
      amount: allocateFeeAmount(f.irrf, note.trades, tradeIndex),
    },
  ];
  return specs.filter((s) => Math.abs(s.amount) >= 0.005);
}

function tradeFeeLedgerLines(
  note: BtgBrokerageNote,
  trade: BtgBrokerageNoteTrade,
  tradeIndex: number,
  lineNo: number,
  anchorLine: LedgerImportLine
): LedgerImportLine[] {
  const ticker = String(anchorLine.ticker || trade.ticker || '').toUpperCase();
  if (!ticker) return [];
  const assetType = anchorLine.asset_type || inferAssetType(ticker);
  const settleDate =
    anchorLine.settlement_date ||
    cashSettlementDate(note.pregaoDate, assetType, anchorLine.operation, ticker);
  const eventRef = eventSourceRefForNote(note);
  const tradeRef = `${B3_NOTE_LEDGER_REF_PREFIX}-${note.noteNumber}#${note.pregaoDate}#${lineNo}`;

  return tradeFeeSpecs(note, tradeIndex).map((spec) => ({
    date: note.pregaoDate,
    ticker,
    asset_type: assetType,
    underlying_ticker:
      trade.underlyingStock?.toUpperCase() || anchorLine.underlying_ticker || ticker,
    operation: 'fee' as const,
    quantity: 0,
    unit_price: spec.amount,
    total_net_value: -Math.abs(spec.amount),
    broker_note_ref: `${tradeRef}#FEE-${spec.suffix}`,
    event_source_ref: eventRef,
    counterparty: 'BTG Pactual',
    source_system: 'b3_brokerage_note',
    settlement_date: settleDate,
    settlement_status: 'pending' as const,
    notes: `${spec.label} — ${trade.ticker} (nota ${note.noteNumber} item ${lineNo})`,
  }));
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
    event_source_ref: eventSourceRefForNote(note),
    counterparty: 'BTG Pactual',
    source_system: 'b3_brokerage_note',
    notes: `Locação BTC — ${trade.specification || trade.ticker}`,
    impacts_managerial_price: false,
    settlement_date: cashSettlementDate(note.pregaoDate, 'securities_lending', 'securities_lending', ticker),
    settlement_status: 'pending',
  };
  applyFeesToLine(line, share, trade);
  // Caixa do aluguel vem do extrato (BTC); evita micro-duplicata com nota LOAN.
  line.total_net_value = 0;
  return line;
}

function tradeToLedger(
  note: BtgBrokerageNote,
  trade: BtgBrokerageNoteTrade,
  lineNo: number
): LedgerImportLine[] {
  const ref = `${B3_NOTE_LEDGER_REF_PREFIX}-${note.noteNumber}#${note.pregaoDate}#${lineNo}`;
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

  const eventRef = eventSourceRefForNote(note);
  for (const line of mapped) {
    if (trade.isExercise && line.operation === 'buy') {
      line.option_strike = Number(trade.unitPrice) || undefined;
      line.notes = line.notes || `Exercício — ${trade.ticker}`;
    }
    applyFeesToLine(line, share, trade);
    line.settlement_date = cashSettlementDate(note.pregaoDate, line.asset_type || 'stock', line.operation, line.ticker);
    line.settlement_status = 'pending';
    line.event_source_ref = eventRef;
    line.counterparty = 'BTG Pactual';
    line.source_system = 'b3_brokerage_note';
  }
  return mapped;
}

/** Converte notas deduplicadas em linhas para LedgerImportService.importEntriesOnly. */
export function brokerageNotesToLedgerLines(notes: BtgBrokerageNote[]): LedgerImportLine[] {
  const lines: LedgerImportLine[] = [];
  for (const note of notes) {
    if (!note.trades.length) continue;
    note.trades.forEach((trade, idx) => {
      const lineNo = idx + 1;
      const tradeLines = tradeToLedger(note, trade, lineNo);
      lines.push(...tradeLines);
      const anchor = tradeLines[0];
      if (anchor) {
        lines.push(...tradeFeeLedgerLines(note, trade, idx, lineNo, anchor));
      }
    });
  }
  return lines;
}

const NOTE_CASH_OPS = new Set<LedgerTransactionType>([
  'buy',
  'sell',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
]);

/** Operacoes de nota que geram expectativa LIQ BOLSA no import mensal. */
export const BROKERAGE_NOTE_CASH_OPS = NOTE_CASH_OPS;

/** Trades + taxas da nota entram no pool pending (bruto − despesas = liquido LIQ). */
export const BROKERAGE_NOTE_PENDING_OPS = new Set<LedgerTransactionType>([
  ...NOTE_CASH_OPS,
  'fee',
]);

/** Import mensal: patrimônio na nota, caixa no extrato (LIQ BOLSA). */
export function suppressBrokerageNoteCashLines(lines: LedgerImportLine[]): LedgerImportLine[] {
  return lines.map((line) => {
    if (!BROKERAGE_NOTE_PENDING_OPS.has(line.operation as LedgerTransactionType)) return line;
    return { ...line, skip_financial_ledger: true };
  });
}
