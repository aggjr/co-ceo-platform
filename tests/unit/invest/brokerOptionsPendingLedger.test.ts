import {
  BROKER_OPTIONS_MISSING_FULL,
  BROKER_OPTIONS_TOP_UP,
  BROKER_OPTIONS_WEGER_TICKER_MIGRATION,
  buildBrokerOptionsPendingLedgerLines,
} from '../../../src/core/invest/brokerOptionsPendingLedger';

describe('brokerOptionsPendingLedger', () => {
  it('gera linhas idempotentes com header único', () => {
    const lines = buildBrokerOptionsPendingLedgerLines();
    const expected =
      BROKER_OPTIONS_MISSING_FULL.length +
      BROKER_OPTIONS_TOP_UP.length +
      BROKER_OPTIONS_WEGER_TICKER_MIGRATION.length;
    expect(lines.length).toBe(expected);
    expect(expected).toBe(15);
    const refs = new Set(lines.map((l) => l.broker_note_ref));
    expect(refs.size).toBe(lines.length);
    for (const l of lines) {
      expect(l.event_source_ref).toBe('BROKER-SNAPSHOT-PENDING:2026-05-23');
      expect(l.source_system).toBe('broker_snapshot_pending_note');
    }
  });

  it('usa call_sell/put_sell e call_buy conforme lado', () => {
    const lines = buildBrokerOptionsPendingLedgerLines();
    const f427 = lines.find((l) => l.ticker === 'ITUBF427');
    const f422 = lines.find((l) => l.ticker === 'ITUBF422' && l.quantity === -300);
    const r441 = lines.find((l) => l.ticker === 'WEGER441');
    expect(f427?.operation).toBe('call_buy');
    expect(f422?.operation).toBe('call_sell');
    expect(r441?.operation).toBe('put_sell');
  });
});
