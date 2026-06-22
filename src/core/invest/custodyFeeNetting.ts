import type { BtgExtractEntry } from './BtgExtractLineParser';
import { MAIN_CASH_TICKER } from './ledgerTypes';

const MONEY_TOL_CENTS = 1;

export type PendingGenericCustodyMove = {
  date: string;
  description: string;
  movementAmount: number;
  /** Valor da despesa (ultima coluna do extrato BTG), quando disponivel. */
  expenseAmount?: number;
  signedNet: number;
  ym: string;
};

/** Referencia BTG "POSICAO 1026" em taxa/estorno de custodia. */
export function custodyPositionRef(description: string): string | null {
  const m = description.match(/POSIC(?:A|Ã|AO)\s+(\d+)/i);
  return m ? m[1]! : null;
}

export function signedEntryCents(entry: BtgExtractEntry): number {
  return Math.round(Number(entry.total_net_value ?? 0) * 100);
}

export function isCustodyNettingEntry(entry: BtgExtractEntry): boolean {
  const notes = String(entry.notes ?? '');
  const ref = String(entry.event_source_ref ?? '');
  if (ref.startsWith('BTG-CUSTODIA-NET:')) return true;
  if (ref.startsWith('BTG-CUSTODIA-MENSAL:') && entry.extract_category === 2) return true;
  if (entry.operation === 'fee' && /CUST[ÓO]DIA|TAXA\s+SOBRE\s+VALOR\s+EM\s+CUST/i.test(notes)) {
    return !/TESOURO|LFT/i.test(notes.toUpperCase());
  }
  if (entry.operation === 'cash_yield' && /REEMBOLSO\s+DE\s+CUST/i.test(notes)) return true;
  if (entry.operation === 'cost_adjustment' && notes.includes('Rateio custodia:')) return true;
  return false;
}

function isEstornoOrReembolso(description: string): boolean {
  return /ESTORNO|REEMBOLSO/i.test(description.toUpperCase());
}

export function canCustodyPairMoves(a: PendingGenericCustodyMove, b: PendingGenericCustodyMove): boolean {
  const ca = Math.round(a.signedNet * 100);
  const cb = Math.round(b.signedNet * 100);
  if (ca === 0 || cb === 0 || Math.sign(ca) === Math.sign(cb)) return false;
  if (Math.abs(Math.abs(ca) - Math.abs(cb)) > MONEY_TOL_CENTS) return false;
  if (a.ym !== b.ym) return false;

  const refA = custodyPositionRef(a.description);
  const refB = custodyPositionRef(b.description);
  if (refA && refB) return refA === refB;

  if (a.date === b.date) return true;

  if (isEstornoOrReembolso(a.description) || isEstornoOrReembolso(b.description)) {
    const dayA = new Date(`${a.date}T12:00:00Z`).getTime();
    const dayB = new Date(`${b.date}T12:00:00Z`).getTime();
    if (Number.isNaN(dayA) || Number.isNaN(dayB)) return false;
    const diffDays = Math.abs(dayA - dayB) / (24 * 60 * 60 * 1000);
    return diffDays <= 7;
  }

  return false;
}

export function buildCustodyNetZeroEntry(
  a: PendingGenericCustodyMove,
  b: PendingGenericCustodyMove
): BtgExtractEntry {
  const refA = custodyPositionRef(a.description);
  const refB = custodyPositionRef(b.description);
  const posKey = refA ?? refB ?? String(Math.abs(Math.round(a.signedNet * 100)));
  const pairKey = `${a.ym}:${posKey}:${posKey}`;
  const neg = a.signedNet < 0 ? a : b;
  const pos = a.signedNet >= 0 ? a : b;
  return {
    date: neg.date <= pos.date ? neg.date : pos.date,
    ticker: MAIN_CASH_TICKER,
    operation: 'fee',
    quantity: 0,
    unit_price: 0,
    total_net_value: 0,
    asset_type: 'cash',
    notes:
      `Custodia anulada (cobranca + estorno/reembolso, liquido zero): ` +
      `${neg.description} | ${pos.description}`,
    event_source_ref: `BTG-CUSTODIA-NET:${pairKey}`,
    extract_category: 2,
  };
}

/** Agrupa rateio custodia (varias pernas) vs fee/cash_yield de estorno no mesmo dia. */
function tryNetAggregatedEntries(entries: BtgExtractEntry[]): {
  kept: BtgExtractEntry[];
  netZero: BtgExtractEntry[];
} {
  const kept: BtgExtractEntry[] = [];
  const pool = entries.filter(isCustodyNettingEntry);
  const rest = entries.filter((e) => !isCustodyNettingEntry(e));
  kept.push(...rest);

  const used = new Set<number>();
  const netZero: BtgExtractEntry[] = [];

  type Agg = { date: string; ym: string; ref: string; idx: number[]; sumCents: number };
  const aggs = new Map<string, Agg>();

  for (let i = 0; i < pool.length; i += 1) {
    const e = pool[i]!;
    const cents = signedEntryCents(e);
    if (cents === 0) {
      used.add(i);
      continue;
    }
    const ym = String(e.date).slice(0, 7);
    const ref = String(e.event_source_ref ?? `D:${e.date}`);
    const key = `${ym}|${e.date}|${ref}|${Math.sign(cents)}`;
    let agg = aggs.get(key);
    if (!agg) {
      agg = { date: String(e.date).slice(0, 10), ym, ref, idx: [], sumCents: 0 };
      aggs.set(key, agg);
    }
    agg.idx.push(i);
    agg.sumCents += cents;
  }

  const posAggs: Agg[] = [];
  const negAggs: Agg[] = [];
  for (const agg of aggs.values()) {
    if (Math.abs(agg.sumCents) <= MONEY_TOL_CENTS) {
      for (const i of agg.idx) used.add(i);
      continue;
    }
    if (agg.sumCents > 0) posAggs.push(agg);
    else negAggs.push(agg);
  }

  for (const neg of negAggs) {
    const match = posAggs.find(
      (pos) =>
        pos.ym === neg.ym &&
        Math.abs(pos.sumCents + neg.sumCents) <= MONEY_TOL_CENTS &&
        (pos.date === neg.date ||
          isEstornoOrReembolso(
            String(pool[pos.idx[0]!]?.notes ?? pool[neg.idx[0]!]?.notes ?? '')
          ))
    );
    if (!match) continue;
    for (const i of neg.idx) used.add(i);
    for (const i of match.idx) used.add(i);
    const negMove: PendingGenericCustodyMove = {
      date: neg.date,
      description: neg.idx.map((i) => pool[i]!.notes ?? '').join(' | '),
      movementAmount: Math.abs(neg.sumCents) / 100,
      signedNet: neg.sumCents / 100,
      ym: neg.ym,
    };
    const posMove: PendingGenericCustodyMove = {
      date: match.date,
      description: match.idx.map((i) => pool[i]!.notes ?? '').join(' | '),
      movementAmount: Math.abs(match.sumCents) / 100,
      signedNet: match.sumCents / 100,
      ym: match.ym,
    };
    netZero.push(buildCustodyNetZeroEntry(negMove, posMove));
    posAggs.splice(posAggs.indexOf(match), 1);
  }

  for (let i = 0; i < pool.length; i += 1) {
    if (!used.has(i)) kept.push(pool[i]!);
  }

  return { kept, netZero };
}

/** Pareia movimentos genericos de custodia antes do rateio mensal. */
export function splitNetZeroCustodyMoves(pending: PendingGenericCustodyMove[]): {
  netZero: BtgExtractEntry[];
  unmatched: PendingGenericCustodyMove[];
} {
  const netZero: BtgExtractEntry[] = [];
  const unmatched: PendingGenericCustodyMove[] = [];
  const used = new Set<number>();

  for (let i = 0; i < pending.length; i += 1) {
    if (used.has(i)) continue;
    let pairIdx = -1;
    for (let j = i + 1; j < pending.length; j += 1) {
      if (used.has(j)) continue;
      if (canCustodyPairMoves(pending[i]!, pending[j]!)) {
        pairIdx = j;
        break;
      }
    }
    if (pairIdx >= 0) {
      used.add(i);
      used.add(pairIdx);
      netZero.push(buildCustodyNetZeroEntry(pending[i]!, pending[pairIdx]!));
    } else {
      unmatched.push(pending[i]!);
    }
  }

  return { netZero, unmatched };
}

export function netZeroCustodyFeePairs(entries: BtgExtractEntry[]): BtgExtractEntry[] {
  const explicitNetZero = entries.filter((e) =>
    String(e.event_source_ref ?? '').startsWith('BTG-CUSTODIA-NET:')
  );
  const toProcess = entries.filter(
    (e) => !String(e.event_source_ref ?? '').startsWith('BTG-CUSTODIA-NET:')
  );

  const first = tryNetAggregatedEntries(toProcess);
  const pool = first.kept.filter(isCustodyNettingEntry);
  const kept = first.kept.filter((e) => !isCustodyNettingEntry(e));
  const netZero = [...first.netZero];
  const used = new Set<number>();

  for (let i = 0; i < pool.length; i += 1) {
    if (used.has(i)) continue;
    const a = pool[i]!;
    const ca = signedEntryCents(a);
    if (ca === 0) {
      used.add(i);
      continue;
    }

    let pairIdx = -1;
    for (let j = i + 1; j < pool.length; j += 1) {
      if (used.has(j)) continue;
      const b = pool[j]!;
      const moveA: PendingGenericCustodyMove = {
        date: String(a.date).slice(0, 10),
        description: String(a.notes ?? ''),
        movementAmount: Math.abs(Number(a.total_net_value ?? 0)),
        signedNet: Number(a.total_net_value ?? 0),
        ym: String(a.date).slice(0, 7),
      };
      const moveB: PendingGenericCustodyMove = {
        date: String(b.date).slice(0, 10),
        description: String(b.notes ?? ''),
        movementAmount: Math.abs(Number(b.total_net_value ?? 0)),
        signedNet: Number(b.total_net_value ?? 0),
        ym: String(b.date).slice(0, 7),
      };
      if (canCustodyPairMoves(moveA, moveB)) {
        pairIdx = j;
        break;
      }
    }

    if (pairIdx >= 0) {
      used.add(i);
      used.add(pairIdx);
      const b = pool[pairIdx]!;
      netZero.push(
        buildCustodyNetZeroEntry(
          {
            date: String(a.date).slice(0, 10),
            description: String(a.notes ?? ''),
            movementAmount: Math.abs(Number(a.total_net_value ?? 0)),
            signedNet: Number(a.total_net_value ?? 0),
            ym: String(a.date).slice(0, 7),
          },
          {
            date: String(b.date).slice(0, 10),
            description: String(b.notes ?? ''),
            movementAmount: Math.abs(Number(b.total_net_value ?? 0)),
            signedNet: Number(b.total_net_value ?? 0),
            ym: String(b.date).slice(0, 7),
          }
        )
      );
    } else {
      kept.push(a);
    }
  }

  return [...kept, ...netZero, ...explicitNetZero];
}
