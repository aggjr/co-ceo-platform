import {
  buildOptionStrikeMapFromLedgerEvents,
  parseOptionTickerFromExerciseNotes,
} from '../../../src/core/invest/optionStrikeFromLedger';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('optionStrikeFromLedger', () => {
  it('extrai ticker da opção nas notas de exercício', () => {
    expect(
      parseOptionTickerFromExerciseNotes(
        'Exercício/atribuição — PRIOP650E (Notas BTG 2026)'
      )
    ).toBe('PRIOP650');
  });

  it('mapeia strike pelo unit_price do exercício no papel', () => {
    const events: LedgerEvent[] = [
      {
        asset_id: '1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'buy',
        quantity: 700,
        unit_price: 65,
        total_net_value: 45500,
        notes: 'Exercício/atribuição — PRIOP650E (Notas BTG)',
      },
    ];
    const map = buildOptionStrikeMapFromLedgerEvents(events);
    expect(map.get('PRIOP650')).toBe(65);
  });
});
