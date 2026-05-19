import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';
import {
  BTG_CASH_STATEMENT_BALANCE_2026_05_19,
  cashBalanceFromLedger,
  resolveCashInvestDisplayBalance,
} from '../../../src/core/invest/cashInvestLedger';
import { BTG_EXTRACT_2026_05_18_19 } from '../../../src/core/invest/btgExtractMay182026';

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

  it('usa âncora do extrato quando livro está incoerente', () => {
    const junk = [
      {
        asset_id: 'c',
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'opening_balance',
        quantity: 58759,
        unit_price: 1,
        total_net_value: 58759,
        transaction_date: '2026-01-01',
      },
    ];
    expect(resolveCashInvestDisplayBalance(junk)).toBe(BTG_CASH_STATEMENT_BALANCE_2026_05_19);
  });
});
