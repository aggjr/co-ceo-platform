/** Tipos do barramento de snapshot de custódia (homebroker → banco → apply). */

export type BrokerCustodyLineKind =
  | 'mark'
  | 'pending_open'
  | 'pending_topup'
  | 'pending_migrate';

export type BrokerPatrimonyComposition = {
  variableIncome: number;
  fixedIncome: number;
  cash: number;
  inTransit: number;
  derivatives: number;
  totalPatrimony: number;
};

export type BrokerPositionMark = {
  ticker: string;
  quantity: number;
  lastPrice: number;
  marketValue: number;
};

export type BrokerCustodySnapshotLineInput = {
  ticker: string;
  lineKind: BrokerCustodyLineKind;
  quantity: number;
  lastPrice?: number | null;
  marketValue?: number | null;
  avgPrice?: number | null;
  legTag?: string | null;
};

export type BrokerCustodySnapshotInput = {
  schemaVersion: number;
  broker: string;
  referenceDate: string;
  sourceLabel?: string | null;
  notes?: string | null;
  composition: BrokerPatrimonyComposition;
  positions: BrokerCustodySnapshotLineInput[];
};

export type BrokerCustodySnapshotRecord = BrokerCustodySnapshotInput & {
  id: string;
  organizationId: string;
  status: 'imported' | 'applied' | 'superseded';
};

export function sumBrokerMarks(marks: BrokerPositionMark[]): number {
  return Math.round(marks.reduce((s, m) => s + m.marketValue, 0) * 100) / 100;
}

export function marksFromSnapshotLines(
  lines: BrokerCustodySnapshotLineInput[]
): BrokerPositionMark[] {
  return lines
    .filter((l) => l.lineKind === 'mark')
    .map((l) => ({
      ticker: l.ticker.toUpperCase(),
      quantity: Number(l.quantity),
      lastPrice: Number(l.lastPrice ?? 0),
      marketValue: Number(l.marketValue ?? 0),
    }));
}
