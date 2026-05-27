/**
 * Deduplicação de movimentos de caixa no extrato BTG (BTG-EXT vs BTG-EXTRACT).
 */
import type { LedgerEvent } from './CustodyEngine';
import { isCashInvestTicker } from './cashInvestLedger';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';

const TRADE_OPS = new Set<LedgerTransactionType>(['buy', 'sell']);
const OPTION_OPS = new Set<LedgerTransactionType>([
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
]);
const PASSIVE_INCOME_OPS = new Set<LedgerTransactionType>([
  'dividend',
  'jcp',
  'cash_yield',
  'securities_lending',
]);
const CAPITAL_OPS = new Set<LedgerTransactionType>(['capital_deposit', 'capital_withdrawal']);
const PASSIVE_EXPENSE_OPS = new Set<LedgerTransactionType>(['fee', 'penalty_b3']);

export function roundCashNet(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Chave estável: data + valor líquido em caixa (sinal preservado). */
export function cashNetKey(date: string, netSigned: number): string {
  return `${String(date).slice(0, 10)}|${roundCashNet(netSigned).toFixed(2)}`;
}

export function isBtgExtractRef(ref: string | null | undefined): boolean {
  const r = String(ref || '');
  return r.startsWith('BTG-EXT-') || r.includes('BTG-EXTRACT');
}

export function isBtgExtractDuplicateRef(ref: string | null | undefined): boolean {
  return String(ref || '').includes('BTG-EXTRACT');
}

/** Valor líquido em caixa que uma linha de import tende a gerar (quando aplicável). */
export function importLineExpectedCashNet(line: LedgerImportLine): number | null {
  const op = line.operation;
  const raw = Number(line.total_net_value ?? 0);
  const fromQty = Math.abs(Number(line.quantity) || 0) * Math.abs(Number(line.unit_price) || 0);

  if (PASSIVE_INCOME_OPS.has(op) || CAPITAL_OPS.has(op)) {
    const n = Math.abs(raw) || fromQty;
    return n >= 0.01 ? roundCashNet(raw >= 0 ? n : -n) : null;
  }
  if (PASSIVE_EXPENSE_OPS.has(op)) {
    const n = Math.abs(raw) || fromQty;
    return n >= 0.01 ? roundCashNet(-n) : null;
  }
  if (TRADE_OPS.has(op) || OPTION_OPS.has(op) || op === 'option_exercise') {
    const gross = Math.abs(raw) || fromQty;
    if (gross < 0.01) return null;
    if (op === 'buy' || op === 'put_buy' || op === 'call_buy') {
      return roundCashNet(-gross);
    }
    return roundCashNet(gross);
  }
  if (op === 'cost_adjustment') {
    const n = Math.abs(raw) || Math.abs(Number(line.unit_price) || 0);
    return n >= 0.01 ? roundCashNet(-n) : null;
  }
  return null;
}

export type CashNetLedgerHit = {
  eventId: string;
  brokerNoteRef: string | null;
  date: string;
  net: number;
};

/** Lista entradas de caixa já existentes com mesma data + valor (tolerância 1 centavo). */
export function findCashNetHits(
  events: LedgerEvent[],
  date: string,
  netSigned: number,
  tolerance = 0.02
): CashNetLedgerHit[] {
  const target = roundCashNet(netSigned);
  const hits: CashNetLedgerHit[] = [];
  for (const e of events) {
    if (!isCashInvestTicker(String(e.asset_ticker))) continue;
    const net = roundCashNet(Number(e.total_net_value ?? 0));
    if (Math.abs(net - target) > tolerance) continue;
    if (String(e.transaction_date || '').slice(0, 10) !== String(date).slice(0, 10)) continue;
    hits.push({
      eventId: String(e.id),
      brokerNoteRef: e.broker_note_ref ? String(e.broker_note_ref) : null,
      date: String(e.transaction_date).slice(0, 10),
      net,
    });
  }
  return hits;
}

export type ExtractCashDuplicate = {
  extractEventId: string;
  extractRef: string | null;
  twinRef: string | null;
  date: string;
  net: number;
  notes: string | null;
};

/**
 * BTG-EXTRACT:* com par BTG-EXT-* (mesmo dia e valor) — candidatos a remoção (ficar com EXT).
 */
export function findBtgExtractCashDuplicates(
  events: LedgerEvent[],
  options: { minAbsAmount?: number } = {}
): ExtractCashDuplicate[] {
  const minAbs = options.minAbsAmount ?? 1000;
  const cash = events.filter((e) => isCashInvestTicker(String(e.asset_ticker)));
  const extByKey = new Map<string, CashNetLedgerHit[]>();

  for (const e of cash) {
    const ref = e.broker_note_ref ? String(e.broker_note_ref) : '';
    if (!ref.startsWith('BTG-EXT-')) continue;
    const net = roundCashNet(Number(e.total_net_value ?? 0));
    if (Math.abs(net) < minAbs) continue;
    const key = cashNetKey(String(e.transaction_date), net);
    const list = extByKey.get(key) || [];
    list.push({
      eventId: String(e.id),
      brokerNoteRef: ref || null,
      date: String(e.transaction_date).slice(0, 10),
      net,
    });
    extByKey.set(key, list);
  }

  const out: ExtractCashDuplicate[] = [];
  for (const e of cash) {
    const ref = e.broker_note_ref ? String(e.broker_note_ref) : '';
    if (!ref.includes('BTG-EXTRACT')) continue;
    const net = roundCashNet(Number(e.total_net_value ?? 0));
    if (Math.abs(net) < minAbs) continue;
    const key = cashNetKey(String(e.transaction_date), net);
    const twins = extByKey.get(key);
    if (!twins?.length) continue;
    out.push({
      extractEventId: String(e.id),
      extractRef: ref,
      twinRef: twins[0]!.brokerNoteRef,
      date: String(e.transaction_date).slice(0, 10),
      net,
      notes: e.notes ? String(e.notes) : null,
    });
  }
  return out;
}
