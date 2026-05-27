import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';
import {
  cashBalanceFromLedger,
  resolveCashInvestDisplayBalance,
} from '../../../src/core/invest/cashInvestLedger';

describe('cashInvestLedger', () => {
  it('saldo caixa = soma total_net_value (não qty×preço)', () => {
    const entries = [
      {
        asset_id: 'cash1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 456_000,
        transaction_date: '2026-05-18',
      },
      {
        asset_id: 'cash1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -453_223.65,
        transaction_date: '2026-05-19',
      },
    ];
    const balance = cashBalanceFromLedger(entries, '2026-05-19');
    expect(balance).toBeCloseTo(2_776.35, 0);

    const { assets } = rebuildCustodyFromLedger(entries);
    const cash = assets.find((a) => a.ticker === 'CAIXA-BTG');
    expect(cash?.quantity).toBeCloseTo(balance, 0);
  });

  it('saldo exibido = livro razão (sem âncora externa)', () => {
    const entries = [
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 10_000,
        transaction_date: '2026-01-01',
      },
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -2_500,
        transaction_date: '2026-02-10',
      },
    ];
    expect(resolveCashInvestDisplayBalance(entries, '2026-02-10')).toBeCloseTo(7_500, 2);
  });

  it('ignora saldo inicial manual duplicado quando já há BTG-EXTRATO-OPENING', () => {
    const entries = [
      {
        id: 'c1',
        asset_id: 'c1',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 449_963.32,
        transaction_date: '2026-01-02',
        broker_note_ref: 'MANUAL-OPENING',
      },
      {
        id: 'c2',
        asset_id: 'c2',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 0,
        unit_price: 0,
        total_net_value: 449_963.32,
        transaction_date: '2026-01-02',
        broker_note_ref: 'BTG-EXTRATO-OPENING-2026-01',
      },
      {
        id: 'c3',
        asset_id: 'c3',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'fee',
        quantity: 0,
        unit_price: 0,
        total_net_value: -100,
        transaction_date: '2026-05-20',
      },
    ];
    expect(cashBalanceFromLedger(entries, '2026-05-20')).toBeCloseTo(449_863.32, 2);
  });

  it('lançamentos posteriores à data de corte são ignorados', () => {
    const entries = [
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 1_000,
        transaction_date: '2026-03-01',
      },
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'capital_deposit',
        quantity: 0,
        unit_price: 0,
        total_net_value: 5_000,
        transaction_date: '2026-04-01',
      },
    ];
    expect(cashBalanceFromLedger(entries, '2026-03-15')).toBeCloseTo(1_000, 2);
  });
});
