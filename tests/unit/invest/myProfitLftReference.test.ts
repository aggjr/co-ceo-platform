import { rebuildCustodyFromLedger, type LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import {
  MYPROFIT_LFT_OPENING_QTY,
  MYPROFIT_LFT_TRADES,
  myProfitLftNetQty,
} from '../../fixtures/myprofit-lft-20310301';

describe('referência MyProfit LFT-20310301', () => {
  it('saldo líquido esperado após todas as operações = 11 cotas', () => {
    expect(myProfitLftNetQty()).toBeCloseTo(11, 2);
  });

  it('soma compras e vendas bate com abertura 58', () => {
    const buys = MYPROFIT_LFT_TRADES.filter((t) => t.side === 'buy').reduce((s, t) => s + t.quantity, 0);
    const sells = MYPROFIT_LFT_TRADES.filter((t) => t.side === 'sell').reduce((s, t) => s + t.quantity, 0);
    expect(MYPROFIT_LFT_OPENING_QTY + buys - sells).toBeCloseTo(11, 2);
  });

  it('CustodyEngine reproduz 11 cotas quando livro espelha MyProfit', () => {
    const events: LedgerEvent[] = [
      {
        asset_id: 'lft1',
        transaction_date: '2026-01-01',
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        quantity: MYPROFIT_LFT_OPENING_QTY,
        unit_price: 17_809.83,
        total_net_value: 1_032_969.97,
      },
    ];
    for (const t of MYPROFIT_LFT_TRADES) {
      events.push({
        asset_id: 'lft1',
        transaction_date: t.date,
        asset_ticker: 'LFT-20310301',
        asset_type: 'fixed_income',
        transaction_type: t.side === 'buy' ? 'buy' : 'sell',
        quantity: t.side === 'buy' ? t.quantity : -t.quantity,
        unit_price: t.unitPrice,
        total_net_value: t.side === 'buy' ? -t.total : t.total,
      });
    }
    const { assets } = rebuildCustodyFromLedger(events);
    const lft = assets.find((a) => a.ticker === 'LFT-20310301');
    expect(lft?.quantity).toBeCloseTo(11, 2);
  });
});
