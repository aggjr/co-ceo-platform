import {
  canonicalTesouroTicker,
  isTesouroDiretoTicker,
  normalizeLedgerLineQuantity,
  normalizeTesouroLedgerQuantity,
} from '../../../src/core/invest/tesouroDirectLedger';
import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';

describe('tesouroDirectLedger (sem hardcode)', () => {
  it('canonicalTesouroTicker eh identidade (preserva o papel passado)', () => {
    expect(canonicalTesouroTicker('LFT-20310301')).toBe('LFT-20310301');
    expect(canonicalTesouroTicker('TESOURO-SELIC-2031')).toBe('TESOURO-SELIC-2031');
    expect(canonicalTesouroTicker('TESOURO-LFT-BTG')).toBe('TESOURO-LFT-BTG');
    expect(canonicalTesouroTicker('itub4')).toBe('ITUB4');
  });

  it('isTesouroDiretoTicker reconhece familias LFT/TESOURO/TD', () => {
    expect(isTesouroDiretoTicker('LFT-20310301')).toBe(true);
    expect(isTesouroDiretoTicker('TESOURO-SELIC-2031')).toBe(true);
    expect(isTesouroDiretoTicker('TD-XYZ')).toBe(true);
    expect(isTesouroDiretoTicker('ITUB4')).toBe(false);
    expect(isTesouroDiretoTicker('CDB-SR-BTG')).toBe(false);
  });

  it('normalizeTesouroLedgerQuantity preserva quantity e unit_price recebidos', () => {
    const norm = normalizeTesouroLedgerQuantity({
      quantity: 1,
      unit_price: 1_000_341.65,
    });
    expect(norm.quantity).toBe(1);
    expect(norm.unit_price).toBeCloseTo(1_000_341.65, 2);
  });

  it('normalizeLedgerLineQuantity nao altera quantity de acoes', () => {
    const norm = normalizeLedgerLineQuantity('ITUB4', {
      quantity: 1200,
      unit_price: 41.43,
    });
    expect(norm.quantity).toBe(1200);
    expect(norm.unit_price).toBeCloseTo(41.43, 2);
  });

  it('normalizeLedgerLineQuantity nao aplica PU estimado em Tesouro', () => {
    const norm = normalizeLedgerLineQuantity('TESOURO-SELIC-2031', {
      quantity: 30,
      unit_price: 18_774.21,
    });
    expect(norm.quantity).toBe(30);
    expect(norm.unit_price).toBeCloseTo(18_774.21, 2);
  });
});

describe('CustodyEngine Tesouro (livro razao com PU real)', () => {
  it('venda parcial reduz a quantidade de titulos sem virar negativa', () => {
    const pu = 18_774.21;
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
        quantity: 15.13,
        unit_price: pu,
        total_net_value: 15.13 * pu,
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
