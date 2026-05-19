import { applyLedgerToPriceState, avgPrice, emptyPriceState } from '../../../src/core/invest/ManagerialPriceEngine';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

function stockBuy(qty: number, price: number): LedgerEvent {
  return {
    asset_id: 'a1',
    asset_ticker: 'PRIO3',
    asset_type: 'stock',
    transaction_type: 'buy',
    quantity: qty,
    unit_price: price,
    total_net_value: -qty * price,
  };
}

function optSellPremium(net: number): LedgerEvent {
  return {
    asset_id: 'o1',
    asset_ticker: 'PRIOA150',
    asset_type: 'option_call',
    underlying_ticker: 'PRIO3',
    transaction_type: 'call_sell',
    quantity: -10,
    unit_price: 1,
    total_net_value: net,
  };
}

describe('ManagerialPriceEngine', () => {
  it('preço estrito ignora prêmio de opção', () => {
    let s = emptyPriceState('PRIO3');
    s = applyLedgerToPriceState(s, stockBuy(100, 40), 'strict');
    s = applyLedgerToPriceState(s, optSellPremium(500), 'strict');
    expect(avgPrice(s, 'strict')).toBe(40);
  });

  it('preço gerencial reduz custo com ganho em opção', () => {
    let s = emptyPriceState('PRIO3');
    s = applyLedgerToPriceState(s, stockBuy(100, 40), 'managerial');
    s = applyLedgerToPriceState(s, optSellPremium(1000), 'managerial');
    expect(avgPrice(s, 'managerial')).toBe(30);
  });

  it('preço B3 só desconta PUT no exercício', () => {
    let s = emptyPriceState('BBAS3');
    const buy: LedgerEvent = { ...stockBuy(300, 22), asset_ticker: 'BBAS3' };
    s = applyLedgerToPriceState(s, buy, 'b3');
    s = applyLedgerToPriceState(
      s,
      {
        asset_id: 'o1',
        asset_ticker: 'BBASQ223',
        asset_type: 'option_put',
        underlying_ticker: 'BBAS3',
        transaction_type: 'option_exercise',
        quantity: 300,
        unit_price: 0,
        total_net_value: 105,
      },
      'b3'
    );
    expect(avgPrice(s, 'b3')).toBeCloseTo(22 - 105 / 300);
  });

  it('preço gerencial sobe com prejuízo em opção', () => {
    let s = emptyPriceState('PRIO3');
    s = applyLedgerToPriceState(s, stockBuy(100, 40), 'managerial');
    s = applyLedgerToPriceState(s, optSellPremium(-500), 'managerial');
    expect(avgPrice(s, 'managerial')).toBe(45);
  });
});
