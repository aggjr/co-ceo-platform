import * as fs from 'fs';
import * as path from 'path';
import { parseBrokerCustodySnapshotJson } from '../../../src/core/invest/brokerCustodySnapshotImport';
import {
  marksFromSnapshotLines,
  sumBrokerMarks,
} from '../../../src/core/invest/brokerCustodySnapshotTypes';
import { buildPendingLedgerLinesFromSnapshot } from '../../../src/core/invest/buildPendingLedgerFromSnapshot';

const fixturePath = path.join(
  __dirname,
  '../../fixtures/broker-custody-snapshot-btg-2026-05-23.json'
);

describe('brokerCustodySnapshotImport', () => {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  it('parseia fixture BTG com composição e linhas mark/pending', () => {
    const snap = parseBrokerCustodySnapshotJson(raw);
    expect(snap.referenceDate).toBe('2026-05-23');
    expect(snap.positions.length).toBeGreaterThan(40);
    const marks = marksFromSnapshotLines(snap.positions);
    expect(sumBrokerMarks(marks)).toBeGreaterThan(1_000_000);
    const pending = snap.positions.filter((p) => p.lineKind !== 'mark');
    expect(pending.length).toBe(15);
  });

  it('gera lançamentos provisórios idempotentes a partir do snapshot', () => {
    const snap = parseBrokerCustodySnapshotJson(raw);
    const record = {
      ...snap,
      id: 'ibs-test',
      organizationId: 'org-holding-001',
      status: 'imported' as const,
    };
    const lines = buildPendingLedgerLinesFromSnapshot(record);
    expect(lines.length).toBe(15);
    expect(lines[0].event_source_ref).toBe('BROKER-SNAPSHOT-PENDING:2026-05-23');
    expect(new Set(lines.map((l) => l.broker_note_ref)).size).toBe(lines.length);
  });
});
