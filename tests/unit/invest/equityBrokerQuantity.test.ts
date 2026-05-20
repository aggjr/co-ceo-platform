import {
  normalizeLedgerEquityQuantity,
  resolveBrokerShareQuantity,
  sanitizeEquityThreePrices,
} from '../../../src/core/invest/equityBrokerQuantity';

describe('equityBrokerQuantity', () => {
  it('normaliza qty em lotes (22 → 2200) e divide PM por 100', () => {
    const { quantity, avgPrice } = normalizeLedgerEquityQuantity(22, 18774.21);
    expect(quantity).toBe(2200);
    expect(avgPrice).toBeCloseTo(187.74, 1);
  });

  it('mantém PRIO3 12700 sem escalar', () => {
    const { quantity, avgPrice } = normalizeLedgerEquityQuantity(12700, 63.54);
    expect(quantity).toBe(12700);
    expect(avgPrice).toBeCloseTo(63.54, 2);
  });

  it('resolve quantidade: snapshot da corretora vence ledger em lotes', () => {
    expect(resolveBrokerShareQuantity(5100, 51, 'stock')).toBe(5100);
    expect(resolveBrokerShareQuantity(6000, 60, 'stock')).toBe(6000);
    expect(resolveBrokerShareQuantity(12700, 12700, 'stock')).toBe(12700);
  });

  it('sanitiza PM B3 absurdo (PU Tesouro) para ação', () => {
    const out = sanitizeEquityThreePrices(
      'stock',
      { strict: 18774, b3: 18774, managerial: 18774 },
      41.2,
      39.62
    );
    expect(out.b3).toBeCloseTo(39.62, 2);
    expect(out.strict).toBeCloseTo(39.62, 2);
  });
});
