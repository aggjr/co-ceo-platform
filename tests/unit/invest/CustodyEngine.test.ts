import { rebuildCustodyFromLedger, type LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('CustodyEngine', () => {
  it('tracks short option from put_sell opening', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 'opt-1',
        asset_ticker: 'PRIOQ43',
        asset_type: 'option_put',
        underlying_ticker: 'PRIO3',
        transaction_type: 'put_sell',
        quantity: -31200,
        unit_price: 3.69,
        total_net_value: 0,
        impacts_managerial_price: true,
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.quantity).toBeCloseTo(-31200);
    expect(assets[0]!.avgPrice).toBeCloseTo(3.69);
  });

  it('não cria LFT negativo quando venda excede compras no livro', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 'lft-1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'buy',
        quantity: 1000,
        unit_price: 1,
        total_net_value: -1000,
        impacts_managerial_price: true,
      },
      {
        asset_id: 'lft-1',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'sell',
        quantity: 5000,
        unit_price: 1,
        total_net_value: 5000,
        impacts_managerial_price: true,
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets.find((a) => a.ticker === 'LFT-20310301')).toBeUndefined();
  });

  it('permite ação vendida a descoberto quando venda excede compras', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 's1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'sell',
        quantity: 500,
        unit_price: 40,
        total_net_value: 20000,
        impacts_managerial_price: true,
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.ticker).toBe('PRIO3');
    expect(assets[0]!.quantity).toBe(-500);
  });
});
