/**
 * Deduplicação de lançamentos de nota: mesma operação pode chegar por
 * MyProfit/ChatGPT (documento), parser BTG (BTG-NOTA-{n}#data#linha) ou extrato.
 */
import type { LedgerEvent } from './CustodyEngine';
import { inferAssetType } from './assetClassifier';
import type { LedgerImportLine } from './ledgerTypes';

export type DedupMatchKind = 'broker_note_ref' | 'bare_note_number' | 'operation_fingerprint';

export type IndexedLedgerOperation = {
  patrimonyEventId?: string;
  cashEventId?: string;
  brokerNoteRef: string | null;
  bareNoteNumber: string | null;
  fingerprint: string;
  date: string;
  ticker: string;
  assetType: string;
  operation: string;
  quantity: number;
  unitPrice: number;
  cashAmount: number | null;
  feesTotal: number;
};

export type LedgerDedupIndex = {
  byRef: Map<string, IndexedLedgerOperation>;
  byNoteNumber: Map<string, IndexedLedgerOperation>;
  byFingerprint: Map<string, IndexedLedgerOperation[]>;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Número da nota BTG (6+ dígitos) extraído de qualquer formato de ref. */
export function extractBareNoteNumber(ref: string | null | undefined): string | null {
  const r = String(ref || '').trim();
  if (!r) return null;
  const m =
    r.match(/BTG-NOTA-(\d{6,})/i) ||
    r.match(/(?:^|#)(\d{6,})(?:#|$)/) ||
    r.match(/^(\d{6,})$/);
  return m ? m[1]! : null;
}

function movementOpFromEvent(e: LedgerEvent): string {
  return String(e.transaction_type || 'unknown');
}

/** Chave estável: data + ativo + tipo + qty + preço (lado inferido pela operação). */
export function buildOperationFingerprint(input: {
  date: string;
  ticker: string;
  operation: string;
  quantity: number;
  unit_price: number;
  asset_type?: string;
}): string {
  const ticker = String(input.ticker || '').toUpperCase().trim();
  const assetType = String(input.asset_type || inferAssetType(ticker));
  const qty = roundMoney(Math.abs(Number(input.quantity) || 0));
  const price = roundMoney(Math.abs(Number(input.unit_price) || 0));
  const op = String(input.operation || '').toLowerCase();
  return `${input.date}|${ticker}|${assetType}|${op}|${qty}|${price}`;
}

export function fingerprintFromImportLine(line: LedgerImportLine): string {
  return buildOperationFingerprint({
    date: line.date,
    ticker: line.ticker,
    operation: line.operation,
    quantity: line.quantity,
    unit_price: line.unit_price,
    asset_type: line.asset_type,
  });
}

export function fingerprintFromLedgerEvent(e: LedgerEvent): string {
  return buildOperationFingerprint({
    date: String(e.transaction_date || ''),
    ticker: e.asset_ticker,
    operation: movementOpFromEvent(e),
    quantity: e.quantity,
    unit_price: e.unit_price,
    asset_type: e.asset_type,
  });
}

function eventFeesTotal(e: LedgerEvent): number {
  return roundMoney(
    Math.abs(Number(e.brokerage_fee ?? 0)) +
      Math.abs(Number(e.b3_fees ?? 0)) +
      Math.abs(Number(e.irrf_tax ?? 0))
  );
}

/**
 * Índice em memória do livro atual para evitar duplicar custódia/caixa no import.
 */
export function buildLedgerDedupIndex(events: LedgerEvent[]): LedgerDedupIndex {
  const byRef = new Map<string, IndexedLedgerOperation>();
  const byNoteNumber = new Map<string, IndexedLedgerOperation>();
  const byFingerprint = new Map<string, IndexedLedgerOperation[]>();
  const cashByRef = new Map<string, { id?: string; amount: number; fees: number }>();

  for (const e of events) {
    if (e.asset_type === 'cash' && e.broker_note_ref) {
      const baseRef = String(e.broker_note_ref).replace(/:CASH$/i, '');
      cashByRef.set(baseRef, {
        id: e.id,
        amount: roundMoney(Math.abs(Number(e.total_net_value) || 0)),
        fees: eventFeesTotal(e),
      });
      const cashOnlyRef = `${baseRef}:CASH`;
      if (e.id) {
        const prev = byRef.get(cashOnlyRef);
        byRef.set(cashOnlyRef, {
          ...(prev || ({} as IndexedLedgerOperation)),
          cashEventId: e.id,
          brokerNoteRef: baseRef,
          bareNoteNumber: extractBareNoteNumber(baseRef),
          fingerprint: prev?.fingerprint || '',
          date: String(e.transaction_date || ''),
          ticker: e.asset_ticker,
          assetType: 'cash',
          operation: movementOpFromEvent(e),
          quantity: 0,
          unitPrice: 0,
          cashAmount: roundMoney(Math.abs(Number(e.total_net_value) || 0)),
          feesTotal: eventFeesTotal(e),
        });
      }
    }
  }

  for (const e of events) {
    if (e.asset_type === 'cash') continue;
    const op = movementOpFromEvent(e);
    if (op === 'fee' || op === 'opening_balance' || op === 'dividend' || op === 'jcp') {
      continue;
    }

    const ref = e.broker_note_ref ? String(e.broker_note_ref) : null;
    const fp = fingerprintFromLedgerEvent(e);
    const bare = extractBareNoteNumber(ref);
    const cash = ref ? cashByRef.get(ref) : undefined;

    const indexed: IndexedLedgerOperation = {
      patrimonyEventId: e.id,
      cashEventId: cash?.id,
      brokerNoteRef: ref,
      bareNoteNumber: bare,
      fingerprint: fp,
      date: String(e.transaction_date || ''),
      ticker: e.asset_ticker,
      assetType: e.asset_type,
      operation: op,
      quantity: roundMoney(Math.abs(Number(e.quantity) || 0)),
      unitPrice: roundMoney(Math.abs(Number(e.unit_price) || 0)),
      cashAmount: cash?.amount ?? null,
      feesTotal: (cash?.fees ?? 0) + eventFeesTotal(e),
    };

    if (ref) byRef.set(ref, indexed);
    if (bare && !byNoteNumber.has(bare)) byNoteNumber.set(bare, indexed);

    const fpList = byFingerprint.get(fp) || [];
    fpList.push(indexed);
    byFingerprint.set(fp, fpList);
  }

  return { byRef, byNoteNumber, byFingerprint };
}

export type DedupLookupResult = {
  existing: IndexedLedgerOperation;
  match: DedupMatchKind;
  /** Outros refs no livro com mesma fingerprint (risco de caixa em dobro). */
  fingerprintSiblings: IndexedLedgerOperation[];
};

export function lookupDuplicate(
  index: LedgerDedupIndex,
  line: LedgerImportLine
): DedupLookupResult | null {
  const ref = line.broker_note_ref?.trim();
  if (ref && index.byRef.has(ref)) {
    const existing = index.byRef.get(ref)!;
    return {
      existing,
      match: 'broker_note_ref',
      fingerprintSiblings: index.byFingerprint.get(fingerprintFromImportLine(line)) || [],
    };
  }

  const bare = extractBareNoteNumber(ref);
  if (bare && index.byNoteNumber.has(bare)) {
    const existing = index.byNoteNumber.get(bare)!;
    return {
      existing,
      match: 'bare_note_number',
      fingerprintSiblings: index.byFingerprint.get(fingerprintFromImportLine(line)) || [],
    };
  }

  const fp = fingerprintFromImportLine(line);
  const siblings = index.byFingerprint.get(fp) || [];
  if (siblings.length > 0) {
    return {
      existing: siblings[0]!,
      match: 'operation_fingerprint',
      fingerprintSiblings: siblings,
    };
  }

  return null;
}

export function importLineFeesTotal(line: LedgerImportLine): number {
  return roundMoney(
    Math.abs(line.brokerage_fee ?? 0) +
      Math.abs(line.b3_fees ?? 0) +
      Math.abs(line.irrf_tax ?? 0)
  );
}

/** Detecta se reimportar geraria segunda perna de caixa com valor equivalente. */
export function wouldDoubleCash(
  existing: IndexedLedgerOperation,
  line: LedgerImportLine
): boolean {
  if (existing.cashEventId && existing.cashAmount != null) {
    const incoming = roundMoney(Math.abs(Number(line.total_net_value) || 0));
    if (incoming > 0 && Math.abs(existing.cashAmount - incoming) < 0.02) {
      return true;
    }
  }
  return false;
}
