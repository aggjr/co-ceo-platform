/**
 * Monta linhas do Histórico de Operações a partir do livro (LedgerEvent[]).
 * Cruza perna patrimonial (qty × preço = valor nominal) com perna de caixa
 * (metadata.fees / b3_fees) pelo mesmo broker_note_ref.
 */
import type { LedgerEvent } from './CustodyEngine';

export type BrokerageNoteReviewRow = {
  dedupeKey: string;
  noteNumber: string;
  pregaoDate: string;
  pregaoDateBr: string;
  category: string;
  sourceFile: string;
  netOperations: number | null;
  settlementTax: number | null;
  registrationTax: number | null;
  cblcTotal: number | null;
  emoluments: number | null;
  bovespaTotal: number | null;
  irrf: number | null;
  feesSource: 'cash_leg' | 'patrimony_meta' | 'implied_gap' | 'none';
  duplicateSkipped: boolean;
  duplicateOf: string | null;
  lineNo: number;
  side: 'C' | 'V' | '—';
  sideLabel: string;
  marketType: string;
  operationLabel: string;
  maturity: string | null;
  ticker: string;
  underlyingStock: string;
  isExercise: boolean;
  specification: string;
  quantity: number;
  unitPrice: number;
  grossValue: number;
  dc: 'C' | 'D' | '—';
};

function isoDateToBr(iso: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function extractFeesFromMeta(meta: Record<string, unknown>): {
  brokerage: number;
  b3: number;
  irrf: number;
  settlement: number;
  registration: number;
  cblc: number;
  bovespa: number;
  emoluments: number;
} {
  const breakdown =
    meta.fee_breakdown && typeof meta.fee_breakdown === 'object'
      ? (meta.fee_breakdown as Record<string, unknown>)
      : null;
  const brokerage = Math.abs(Number(meta.brokerage_fee ?? breakdown?.brokerage ?? 0));
  const b3 = Math.abs(Number(meta.b3_fees ?? breakdown?.b3 ?? meta.fees ?? 0));
  const irrf = Math.abs(Number(meta.irrf_tax ?? breakdown?.irrf ?? 0));
  const settlement = Math.abs(Number(breakdown?.settlement ?? meta.settlement_tax ?? 0));
  const registration = Math.abs(Number(breakdown?.registration ?? meta.registration_tax ?? 0));
  const cblc = Math.abs(Number(breakdown?.cblc ?? meta.cblc_total ?? 0));
  const bovespa = Math.abs(Number(breakdown?.bovespa ?? meta.bovespa_total ?? 0));
  const emoluments = Math.abs(
    Number(breakdown?.emoluments ?? meta.emoluments ?? 0)
  );
  return { brokerage, b3, irrf, settlement, registration, cblc, bovespa, emoluments };
}

export function eventFeeTotal(e: LedgerEvent): number {
  return (
    Math.abs(Number(e.brokerage_fee ?? 0)) +
    Math.abs(Number(e.b3_fees ?? 0)) +
    Math.abs(Number(e.irrf_tax ?? 0))
  );
}

/** Valor nominal da operação (qty × preço), sem taxas. */
export function nominalGross(e: LedgerEvent): number {
  return Math.round(Math.abs(Number(e.quantity) || 0) * Math.abs(Number(e.unit_price) || 0) * 100) /
    100;
}

/**
 * Diferença entre nominal e líquido patrimonial — útil quando não há perna de caixa.
 * Compra: líquido costuma ser nominal + taxas; venda: nominal − taxas.
 */
export function impliedFeesFromGap(e: LedgerEvent, side: 'C' | 'V' | '—'): number {
  const nominal = nominalGross(e);
  const net = Math.abs(Number(e.total_net_value) || 0);
  if (nominal <= 0 || net <= 0) return 0;
  const gap = Math.abs(nominal - net);
  if (gap > nominal * 0.35) return 0;
  if (side === 'C') return net > nominal ? Math.round((net - nominal) * 100) / 100 : gap;
  if (side === 'V') return nominal > net ? Math.round((nominal - net) * 100) / 100 : gap;
  return Math.round(gap * 100) / 100;
}

function inferSide(e: LedgerEvent): 'C' | 'V' | '—' {
  const tx = String(e.transaction_type || '');
  if (tx.includes('buy')) return 'C';
  if (tx.includes('sell')) return 'V';
  if (tx === 'acquisition') return 'C';
  if (tx === 'disposition') return 'V';
  if (e.quantity > 0) return 'C';
  if (e.quantity < 0) return 'V';
  return '—';
}

function isTradeEvent(e: LedgerEvent): boolean {
  if (e.asset_type === 'cash') return false;
  const tx = String(e.transaction_type || '');
  if (tx === 'fee' || tx === 'cost_adjustment' || tx === 'dividend' || tx === 'jcp') {
    return false;
  }
  return true;
}

export function buildBrokerageNoteReviewRows(
  events: LedgerEvent[],
  todayIso: string
): BrokerageNoteReviewRow[] {
  const feesByRef = new Map<
    string,
    ReturnType<typeof extractFeesFromMeta> & { source: 'cash_leg' | 'patrimony_meta' }
  >();

  for (const e of events) {
    if (e.asset_type !== 'cash' || !e.broker_note_ref) continue;
    const parsed = extractFeesFromMeta({
      brokerage_fee: e.brokerage_fee,
      b3_fees: e.b3_fees,
      irrf_tax: e.irrf_tax,
      fees: eventFeeTotal(e),
    });
    const total =
      parsed.brokerage +
      parsed.b3 +
      parsed.irrf +
      parsed.settlement +
      parsed.registration +
      parsed.cblc +
      parsed.bovespa +
      parsed.emoluments;
    if (total <= 0) continue;
    feesByRef.set(e.broker_note_ref, { ...parsed, source: 'cash_leg' });
  }

  const noteNets = new Map<string, number>();
  for (const e of events) {
    if (!e.broker_note_ref || e.asset_type === 'cash') continue;
    if (!isTradeEvent(e)) continue;
    noteNets.set(
      e.broker_note_ref,
      (noteNets.get(e.broker_note_ref) || 0) + Number(e.total_net_value || 0)
    );
  }

  const noteLineCount = new Map<string, number>();
  const rows: BrokerageNoteReviewRow[] = [];

  for (const e of events) {
    if (!isTradeEvent(e)) continue;

    const noteNum = e.broker_note_ref || '—';
    const lineNo = (noteLineCount.get(noteNum) || 0) + 1;
    noteLineCount.set(noteNum, lineNo);

    const side = inferSide(e);
    let category = 'SPOT';
    if (e.asset_type === 'option_call' || e.asset_type === 'option_put') {
      category = 'OPTIONS';
    } else if (e.transaction_type === 'securities_lending') {
      category = 'LOAN';
    }

    const grossValue = nominalGross(e);
    const isExercise = e.transaction_type === 'option_exercise';
    const pregaoDate = e.transaction_date || todayIso;

    const cashFees = noteNum !== '—' ? feesByRef.get(noteNum) : undefined;
    let feesSource: BrokerageNoteReviewRow['feesSource'] = 'none';
    let settlementTax: number | null = null;
    let registrationTax: number | null = null;
    let cblcTotal: number | null = null;
    let emoluments: number | null = null;
    let bovespaTotal: number | null = null;
    let irrf: number | null = null;

    if (cashFees) {
      feesSource = cashFees.source;
      settlementTax = cashFees.settlement || null;
      registrationTax = cashFees.registration || null;
      cblcTotal = cashFees.cblc || null;
      bovespaTotal = cashFees.bovespa || null;
      irrf = cashFees.irrf || null;
      const detailed =
        cashFees.settlement +
        cashFees.registration +
        cashFees.cblc +
        cashFees.bovespa +
        cashFees.emoluments;
      emoluments =
        cashFees.emoluments ||
        (detailed > 0 ? detailed : cashFees.b3 + cashFees.brokerage) ||
        null;
    } else {
      const patTotal = eventFeeTotal(e);
      if (patTotal > 0) {
        feesSource = 'patrimony_meta';
        emoluments = patTotal;
        irrf = Math.abs(Number(e.irrf_tax ?? 0)) || null;
      } else {
        const implied = impliedFeesFromGap(e, side);
        if (implied > 0.001) {
          feesSource = 'implied_gap';
          emoluments = implied;
        }
      }
    }

    rows.push({
      dedupeKey: `DB|${e.id}`,
      noteNumber: noteNum,
      pregaoDate,
      pregaoDateBr: isoDateToBr(pregaoDate),
      category,
      sourceFile: e.notes || 'Livro razão',
      netOperations: noteNum !== '—' ? noteNets.get(noteNum) ?? null : e.total_net_value,
      settlementTax,
      registrationTax,
      cblcTotal,
      emoluments,
      bovespaTotal,
      irrf,
      feesSource,
      duplicateSkipped: false,
      duplicateOf: null,
      lineNo,
      side,
      sideLabel: side === 'C' ? 'Compra' : side === 'V' ? 'Venda' : '—',
      marketType: isExercise ? 'EXERCÍCIO' : category === 'OPTIONS' ? 'OPÇÕES' : 'VISTA',
      operationLabel: isExercise ? 'Exercício' : side === 'C' ? 'Compra' : 'Venda',
      maturity: null,
      ticker: e.asset_ticker,
      underlyingStock: e.underlying_ticker || e.asset_ticker,
      isExercise,
      specification: '',
      quantity: Math.abs(e.quantity),
      unitPrice: e.unit_price,
      grossValue,
      dc: side === 'C' ? 'D' : side === 'V' ? 'C' : '—',
    });
  }

  rows.sort((a, b) => {
    const d = String(a.pregaoDate).localeCompare(String(b.pregaoDate));
    if (d !== 0) return d;
    return String(a.noteNumber).localeCompare(String(b.noteNumber));
  });

  return rows;
}
