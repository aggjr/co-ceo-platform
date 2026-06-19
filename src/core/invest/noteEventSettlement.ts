/**
 * Conciliacao contabil nota B3 - eventos - LIQ BOLSA.
 */
import type { BtgBrokerageNote } from './btgBrokerageNoteParser';
import type { LedgerImportLine, LedgerTransactionType } from './ledgerTypes';

export const NOTE_SETTLEMENT_TOLERANCE_CENTS = 1;

export type NoteSettlementStatus = 'closed' | 'open' | 'waiting';

export type NoteSettlementAssessment = {
  noteNumber: string;
  pregaoDate: string;
  status: NoteSettlementStatus;
  expectedCents: number;
  poolCents: number;
  materializedCents: number;
  deltaPoolCents: number;
  deltaMaterializedCents: number;
  eventCount: number;
  detail: string;
};

export const NOTE_PENDING_FINANCIAL_OPS = new Set<LedgerTransactionType>([
  'buy',
  'sell',
  'put_sell',
  'put_buy',
  'call_sell',
  'call_buy',
  'option_exercise',
  'fee',
]);

export function noteGroupRef(noteNumber: string): string {
  return `B3-NOTA-${noteNumber}`;
}

export function eventSourceRefForTrade(noteNumber: string, lineNo: number): string {
  return `${noteGroupRef(noteNumber)}#${lineNo}`;
}

export function parseNoteNumberFromBrokerRef(ref: string | null | undefined): string | null {
  const m = /^(?:B3|BTG)-NOTA-(\d+)/i.exec(String(ref ?? '').trim());
  return m ? m[1]! : null;
}

export function signedCentsFromPendingImportLine(line: LedgerImportLine): number | null {
  if (line.skip_financial_ledger !== true) return null;
  if (!NOTE_PENDING_FINANCIAL_OPS.has(line.operation as LedgerTransactionType)) return null;
  const signed =
    Number(line.total_net_value ?? Number(line.quantity) * Number(line.unit_price)) || 0;
  return Math.round(signed * 100);
}

export function poolCentsForNoteLines(lines: LedgerImportLine[], noteNumber: string): number {
  let sum = 0;
  for (const line of lines) {
    if (parseNoteNumberFromBrokerRef(line.broker_note_ref) !== noteNumber) continue;
    const cents = signedCentsFromPendingImportLine(line);
    if (cents !== null) sum += cents;
  }
  return sum;
}

export function expectedNetCents(note: BtgBrokerageNote): number | null {
  const net = note.netSettlement ?? note.netOperations;
  if (net == null || Number.isNaN(Number(net))) return null;
  return Math.round(Number(net) * 100);
}

export function assessNoteInternalPool(
  note: BtgBrokerageNote,
  importLines: LedgerImportLine[]
): Pick<NoteSettlementAssessment, 'expectedCents' | 'poolCents' | 'deltaPoolCents' | 'eventCount'> & {
  poolOk: boolean;
} {
  const expectedCents = expectedNetCents(note) ?? 0;
  const poolCents = poolCentsForNoteLines(importLines, note.noteNumber);
  const eventCount = importLines.filter(
    (l) =>
      parseNoteNumberFromBrokerRef(l.broker_note_ref) === note.noteNumber &&
      l.operation !== 'fee' &&
      signedCentsFromPendingImportLine(l) !== null
  ).length;
  const deltaPoolCents = poolCents - expectedCents;
  const poolOk =
    expectedCents === 0 ||
    Math.abs(deltaPoolCents) <= NOTE_SETTLEMENT_TOLERANCE_CENTS;
  return { expectedCents, poolCents, deltaPoolCents, eventCount, poolOk };
}

export function assessNoteSettlement(
  note: BtgBrokerageNote,
  importLines: LedgerImportLine[],
  materializedCents: number
): NoteSettlementAssessment {
  const internal = assessNoteInternalPool(note, importLines);
  const deltaMaterializedCents = materializedCents - internal.expectedCents;
  const materializedOk =
    internal.expectedCents === 0 ||
    Math.abs(deltaMaterializedCents) <= NOTE_SETTLEMENT_TOLERANCE_CENTS;

  let status: NoteSettlementStatus = 'closed';
  let detail = 'Nota fechada: pool e materializacao conferem.';

  if (!internal.poolOk) {
    status = 'open';
    detail =
      `Pool pending (${(internal.poolCents / 100).toFixed(2)}) != liquido nota ` +
      `(${(internal.expectedCents / 100).toFixed(2)}).`;
  } else if (materializedCents === 0 && internal.poolCents !== 0) {
    status = 'waiting';
    detail = 'Expectativa registrada; aguardando LIQ BOLSA no extrato.';
  } else if (!materializedOk) {
    status = 'open';
    detail =
      `LIQ casada (${(materializedCents / 100).toFixed(2)}) != liquido nota ` +
      `(${(internal.expectedCents / 100).toFixed(2)}). Evento(s) sem materializacao financeira.`;
  }

  return {
    noteNumber: note.noteNumber,
    pregaoDate: note.pregaoDate,
    status,
    expectedCents: internal.expectedCents,
    poolCents: internal.poolCents,
    materializedCents,
    deltaPoolCents: internal.deltaPoolCents,
    deltaMaterializedCents,
    eventCount: internal.eventCount,
    detail,
  };
}

export function assessNotesFromImportLines(
  notes: BtgBrokerageNote[],
  importLines: LedgerImportLine[],
  materializedByNote: Record<string, number> = {}
): NoteSettlementAssessment[] {
  return notes.map((note) =>
    assessNoteSettlement(note, importLines, materializedByNote[note.noteNumber] ?? 0)
  );
}

export function summarizeNoteSettlements(assessments: NoteSettlementAssessment[]): {
  closed: number;
  open: number;
  waiting: number;
  openNotes: NoteSettlementAssessment[];
} {
  const openNotes = assessments.filter((a) => a.status === 'open');
  return {
    closed: assessments.filter((a) => a.status === 'closed').length,
    open: openNotes.length,
    waiting: assessments.filter((a) => a.status === 'waiting').length,
    openNotes,
  };
}
