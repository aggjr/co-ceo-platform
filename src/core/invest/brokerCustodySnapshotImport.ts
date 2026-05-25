import type {
  BrokerCustodyLineKind,
  BrokerCustodySnapshotInput,
  BrokerCustodySnapshotLineInput,
  BrokerPatrimonyComposition,
} from './brokerCustodySnapshotTypes';

const LINE_KINDS = new Set<BrokerCustodyLineKind>([
  'mark',
  'pending_open',
  'pending_topup',
  'pending_migrate',
]);

function num(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Campo inválido "${field}": esperado número.`);
  }
  return n;
}

function parseComposition(raw: unknown): BrokerPatrimonyComposition {
  if (!raw || typeof raw !== 'object') {
    throw new Error('composition obrigatório no snapshot.');
  }
  const c = raw as Record<string, unknown>;
  return {
    variableIncome: num(c.variableIncome, 'composition.variableIncome'),
    fixedIncome: num(c.fixedIncome, 'composition.fixedIncome'),
    cash: num(c.cash, 'composition.cash'),
    inTransit: num(c.inTransit, 'composition.inTransit'),
    derivatives: num(c.derivatives, 'composition.derivatives'),
    totalPatrimony: num(c.totalPatrimony, 'composition.totalPatrimony'),
  };
}

function parseLine(raw: unknown, index: number): BrokerCustodySnapshotLineInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`positions[${index}] inválido.`);
  }
  const row = raw as Record<string, unknown>;
  const kind = String(row.lineKind ?? 'mark').trim() as BrokerCustodyLineKind;
  if (!LINE_KINDS.has(kind)) {
    throw new Error(`positions[${index}].lineKind inválido: ${row.lineKind}`);
  }
  const ticker = String(row.ticker ?? '').trim().toUpperCase();
  if (!ticker) throw new Error(`positions[${index}].ticker obrigatório.`);

  const quantity = num(row.quantity, `positions[${index}].quantity`);
  const line: BrokerCustodySnapshotLineInput = {
    ticker,
    lineKind: kind,
    quantity,
    legTag: row.legTag != null ? String(row.legTag) : null,
  };
  if (row.lastPrice != null) line.lastPrice = num(row.lastPrice, `positions[${index}].lastPrice`);
  if (row.marketValue != null) {
    line.marketValue = num(row.marketValue, `positions[${index}].marketValue`);
  }
  if (row.avgPrice != null) line.avgPrice = num(row.avgPrice, `positions[${index}].avgPrice`);

  if (kind === 'mark') {
    if (line.lastPrice == null || line.lastPrice <= 0) {
      throw new Error(`positions[${index}]: mark exige lastPrice > 0.`);
    }
  } else if (line.avgPrice == null || line.avgPrice <= 0) {
    throw new Error(`positions[${index}]: ${kind} exige avgPrice > 0.`);
  }

  return line;
}

/** Valida e normaliza JSON de importação (arquivo local ou upload futuro). */
export function parseBrokerCustodySnapshotJson(raw: unknown): BrokerCustodySnapshotInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Snapshot: JSON inválido.');
  }
  const doc = raw as Record<string, unknown>;
  const schemaVersion = Number(doc.schemaVersion ?? 1);
  if (schemaVersion !== 1) {
    throw new Error(`schemaVersion ${schemaVersion} não suportado (use 1).`);
  }
  const broker = String(doc.broker ?? 'btg').trim().toLowerCase();
  const referenceDate = String(doc.referenceDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    throw new Error('referenceDate obrigatório (YYYY-MM-DD).');
  }
  const positionsRaw = doc.positions;
  if (!Array.isArray(positionsRaw) || positionsRaw.length === 0) {
    throw new Error('positions[] obrigatório com ao menos uma linha.');
  }

  return {
    schemaVersion: 1,
    broker,
    referenceDate,
    sourceLabel: doc.sourceLabel != null ? String(doc.sourceLabel) : null,
    notes: doc.notes != null ? String(doc.notes) : null,
    composition: parseComposition(doc.composition),
    positions: positionsRaw.map((row, i) => parseLine(row, i)),
  };
}
