import {
  isLikelyOptionExercise,
  mapBrokerOrderToLedger,
} from '../../../src/core/invest/brokerOrderMapper';

describe('brokerOrderMapper', () => {
  it('detects exercise by E/F suffix and strike-like price', () => {
    expect(isLikelyOptionExercise('BBASQ223E', 22)).toBe(true);
    expect(isLikelyOptionExercise('ITUBQ413F', 41.43)).toBe(true);
    expect(isLikelyOptionExercise('PRIOE705', 0.1)).toBe(false);
  });

  it('maps put sell premium to PRIO3 gerencial', () => {
    const lines = mapBrokerOrderToLedger({
      ticker: 'PRIOQ580',
      direction: 'V',
      quantity: 900,
      avgPrice: 1.27,
      date: '2026-04-24',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].operation).toBe('put_sell');
    expect(lines[0].underlying_ticker).toBe('PRIO3');
    expect(lines[0].total_net_value).toBeCloseTo(900 * 1.27);
  });

  it('maps May put exercise to stock buy on BBAS3', () => {
    const lines = mapBrokerOrderToLedger({
      ticker: 'BBASQ223E',
      direction: 'C',
      quantity: 300,
      avgPrice: 22,
      date: '2026-05-15T18:15:00',
    });
    expect(lines[0].ticker).toBe('BBAS3');
    expect(lines[0].operation).toBe('buy');
    expect(lines[0].quantity).toBe(300);
    expect(lines[0].unit_price).toBe(22);
  });

  it('maps ITUB put exercise to ITUB4', () => {
    const lines = mapBrokerOrderToLedger({
      ticker: 'ITUBQ445E',
      direction: 'C',
      quantity: 900,
      avgPrice: 40.72,
      date: '2026-05-15',
    });
    expect(lines[0].ticker).toBe('ITUB4');
    expect(lines).toHaveLength(1);
  });

  it('adds B3 option_exercise line when put premium is known', () => {
    const lines = mapBrokerOrderToLedger(
      {
        ticker: 'BBASQ223E',
        direction: 'C',
        quantity: 300,
        avgPrice: 22,
        date: '2026-05-15',
      },
      { putPremiumNetForB3: 105 }
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].operation).toBe('option_exercise');
    expect(lines[1].ticker).toBe('BBASQ223');
    expect(lines[1].total_net_value).toBe(105);
    expect(lines[1].impacts_managerial_price).toBe(false);
  });
});
