import { validateEquityThreePrices } from '../../../src/core/invest/threePricesValidation';

describe('threePricesValidation', () => {
  it('OK quando tela bate com engine e extensão', () => {
    const r = validateEquityThreePrices({
      ticker: 'PRIO3',
      custodyQty: 5400,
      engineSnapshot: {
        qty: 5400,
        estrito: 40,
        b3: 38,
        gerencial: 35,
        lotStart: '2026-01-01',
      },
      storedExt: { strict: 40, b3: 38, managerial: 35 },
      displayed: { strict: 40, b3: 38, managerial: 35 },
    });
    expect(r.status).toBe('ok');
    expect(r.codes).toHaveLength(0);
  });

  it('erro quando UI diverge do livro', () => {
    const r = validateEquityThreePrices({
      ticker: 'PRIO3',
      custodyQty: 100,
      engineSnapshot: {
        qty: 100,
        estrito: 50,
        b3: 48,
        gerencial: 45,
        lotStart: '2026-01-01',
      },
      storedExt: null,
      displayed: { strict: 55, b3: 48, managerial: 45 },
    });
    expect(r.status).toBe('error');
    expect(r.codes).toContain('UI_VS_ENGINE_E');
  });
});
