import { harmonizeQuantityWithFinancialAmount } from '../../../src/core/invest/financialQuantityCoherence';

describe('financialQuantityCoherence', () => {
  it('deriva qty fracionaria a partir do PM sem arredondar para inteiro', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 3464.79,
      referenceUnitPrice: 18_235.75,
    });
    expect(hit).toBeDefined();
    expect(hit!.quantity).toBeLessThan(1);
    expect(hit!.quantity).toBeGreaterThan(0.1);
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(3464.79, 2);
  });

  it('mantem qty da tabela TD e recalcula PU para bater o valor liquido', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 52_557.07,
      quantity: 2.89,
      referenceUnitPrice: 18_185.84,
    });
    expect(hit!.quantity).toBe(2.89);
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(52_557.07, 2);
  });

  it('limita venda fracionaria a custodia disponivel', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 468_986.25,
      referenceUnitPrice: 18_000,
      maxQuantity: 10,
    });
    expect(hit!.quantity).toBe(10);
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(468_986.25, 2);
  });

  it('prefere qty inteira quando fecha o valor financeiro (Jan/09 LFT)', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 54_160.08,
      referenceUnitPrice: 17_809.83,
    });
    expect(hit!.quantity).toBe(3);
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(54_160.08, 2);
  });

  it('venda LFT com PU errado prefere qty inteira quando fecha valor (MyProfit 18/05)', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 75_742.88,
      referenceUnitPrice: 18_500,
    });
    expect(hit!.quantity).toBe(4);
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(75_742.88, 2);
  });

  it('usa mais casas decimais quando necessario para coerencia centavo', () => {
    const hit = harmonizeQuantityWithFinancialAmount({
      financialAmount: 12_987.88,
      referenceUnitPrice: 18_554.12,
    });
    expect(hit!.quantity * hit!.unit_price).toBeCloseTo(12_987.88, 2);
    expect(hit!.quantity).toBeGreaterThan(0.69);
    expect(hit!.quantity).toBeLessThan(0.71);
  });
});
