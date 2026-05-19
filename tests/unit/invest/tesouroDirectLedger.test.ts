import {
  canonicalTesouroTicker,
  normalizeTesouroLedgerQuantity,
} from '../../../src/core/invest/tesouroDirectLedger';
import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';

describe('tesouroDirectLedger', () => {
  it('normaliza venda do extrato 18/05/2026 (valor em R$) para títulos', () => {
    const norm = normalizeTesouroLedgerQuantity({
      quantity: 284035.8,
      unit_price: 1,
      total_net_value: 284035.8,
      date: '2026-05-18',
    });
    expect(norm.unit_price).toBeCloseTo(18774.21, 0);
    expect(norm.quantity).toBeCloseTo(15.13, 1);
  });

  it('unifica tickers LFT e Tesouro Selic', () => {
    expect(canonicalTesouroTicker('LFT-20310301')).toBe('TESOURO-SELIC-2031');
    expect(canonicalTesouroTicker('TESOURO-SELIC-2031')).toBe('TESOURO-SELIC-2031');
  });
});

describe('CustodyEngine tesouro', () => {
  it('aplica vendas de maio/2026 sem gerar posição negativa', () => {
    const pu = 18774.21;
    const openingUnits = 30;
    const entries = [
      {
        asset_id: 'td1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        quantity: openingUnits,
        unit_price: pu,
        total_net_value: -openingUnits * pu,
        impacts_managerial_price: true,
        transaction_date: '2026-01-01',
      },
      {
        asset_id: 'td1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'sell',
        quantity: 284035.8,
        unit_price: 1,
        total_net_value: 284035.8,
        impacts_managerial_price: true,
        transaction_date: '2026-05-18',
      },
      {
        asset_id: 'td1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'sell',
        quantity: 56807.16,
        unit_price: 1,
        total_net_value: 56807.16,
        impacts_managerial_price: true,
        transaction_date: '2026-05-18',
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.quantity).toBeGreaterThan(0);
    expect(assets[0]!.quantity).toBeLessThan(openingUnits);
  });
});
