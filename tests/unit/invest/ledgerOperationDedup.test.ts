import {
  buildLedgerDedupIndex,
  buildOperationFingerprint,
  extractBareNoteNumber,
  lookupDuplicate,
  wouldDoubleCash,
} from '../../../src/core/invest/ledgerOperationDedup';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import type { LedgerImportLine } from '../../../src/core/invest/ledgerTypes';

function ev(partial: Partial<LedgerEvent>): LedgerEvent {
  return {
    asset_id: '1',
    asset_ticker: 'PRIOM385',
    asset_type: 'option_put',
    quantity: 2500,
    unit_price: 0.16,
    total_net_value: 400,
    transaction_type: 'put_sell',
    ...partial,
  } as LedgerEvent;
}

describe('ledgerOperationDedup', () => {
  it('extractBareNoteNumber em formatos BTG e MyProfit', () => {
    expect(extractBareNoteNumber('BTG-NOTA-30062760#2026-03-10#1')).toBe('30062760');
    expect(extractBareNoteNumber('30062760')).toBe('30062760');
  });

  it('detecta mesma operação com refs diferentes', () => {
    const refA = 'BTG-NOTA-30062760#2026-03-10#1';
    const refB = '30062760';
    const events: LedgerEvent[] = [
      ev({
        id: 'p1',
        broker_note_ref: refA,
        transaction_date: '2026-03-10',
      }),
      {
        id: 'c1',
        asset_type: 'cash',
        asset_ticker: 'CAIXA-BTG',
        asset_id: 'c',
        broker_note_ref: refA,
        transaction_date: '2026-03-10',
        quantity: 0,
        unit_price: 0,
        total_net_value: -399.75,
        transaction_type: 'put_sell',
        b3_fees: 0.25,
      },
    ];
    const index = buildLedgerDedupIndex(events);
    const line: LedgerImportLine = {
      date: '2026-03-10',
      ticker: 'PRIOM385',
      operation: 'put_sell',
      quantity: 2500,
      unit_price: 0.16,
      total_net_value: 399.75,
      broker_note_ref: refB,
      b3_fees: 0.3,
    };
    const dup = lookupDuplicate(index, line);
    expect(dup?.match).toBe('bare_note_number');
    expect(wouldDoubleCash(dup!.existing, line)).toBe(true);
  });

  it('fingerprint estável', () => {
    const a = buildOperationFingerprint({
      date: '2026-03-10',
      ticker: 'prio3',
      operation: 'buy',
      quantity: 100,
      unit_price: 10.5,
      asset_type: 'stock',
    });
    const b = buildOperationFingerprint({
      date: '2026-03-10',
      ticker: 'PRIO3',
      operation: 'buy',
      quantity: 100,
      unit_price: 10.5,
      asset_type: 'stock',
    });
    expect(a).toBe(b);
  });
});
