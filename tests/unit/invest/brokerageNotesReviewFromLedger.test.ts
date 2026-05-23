import {
  buildBrokerageNoteReviewRows,
  impliedFeesFromGap,
  nominalGross,
} from '../../../src/core/invest/brokerageNotesReviewFromLedger';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function trade(partial: Partial<LedgerEvent>): LedgerEvent {
  return {
    asset_id: '1',
    asset_ticker: 'PRIO3',
    asset_type: 'stock',
    quantity: 100,
    unit_price: 10,
    total_net_value: 1000,
    transaction_type: 'buy',
    ...partial,
  } as LedgerEvent;
}

describe('brokerageNotesReviewFromLedger', () => {
  it('nominalGross = qty × preço', () => {
    expect(nominalGross(trade({ quantity: 2500, unit_price: 0.16 }))).toBe(400);
  });

  it('cruza taxas da perna de caixa pelo broker_note_ref', () => {
    const ref = 'BTG-NOTA-1#2026-01-05#1';
    const rows = buildBrokerageNoteReviewRows(
      [
        trade({
          id: 't1',
          broker_note_ref: ref,
          transaction_date: '2026-01-05',
          quantity: 2500,
          unit_price: 0.16,
          total_net_value: 400,
        }),
        {
          id: 'c1',
          asset_type: 'cash',
          asset_ticker: 'CAIXA-DEFAULT',
          asset_id: 'c',
          broker_note_ref: ref,
          transaction_date: '2026-01-05',
          quantity: 0,
          unit_price: 0,
          total_net_value: -400.25,
          transaction_type: 'buy',
          b3_fees: 0.25,
        },
      ],
      '2026-05-23'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].grossValue).toBe(400);
    expect(rows[0].emoluments).toBe(0.25);
    expect(rows[0].feesSource).toBe('cash_leg');
  });

  it('impliedFeesFromGap quando compra líquida > nominal', () => {
    const e = trade({ quantity: 100, unit_price: 10, total_net_value: 1005 });
    expect(impliedFeesFromGap(e, 'C')).toBe(5);
  });
});
