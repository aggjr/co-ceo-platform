import { ThreePricesValuation } from '../../../../src/modules/invest/ThreePricesValuation';
import type { PositionState } from '../../../../src/core/inventory/types';

const empty: PositionState = {
  quantity: 0,
  pmA: 0,
  pmB: null,
  pmC: null,
  acquisitionValue: 0,
  currentValue: 0,
};

describe('ThreePricesValuation', () => {
  const v = new ThreePricesValuation();

  it('opening_balance: 3 precos iguais ao unitValue', () => {
    const state = v.applyMovement(empty, {
      itemId: 'PRIO3',
      transactionDate: '2026-01-01',
      movementType: 'opening_balance',
      quantityDelta: 5400,
      unitValue: 38.33,
    });
    expect(state.quantity).toBe(5400);
    expect(state.pmA).toBeCloseTo(38.33, 4);
    expect(state.pmB).toBeCloseTo(38.33, 4);
    expect(state.pmC).toBeCloseTo(38.33, 4);
    expect(state.currentValue).toBeCloseTo(206982, 2);
  });

  it('opcao vendida (short): qty negativo, PMs todos iguais ao unitValue', () => {
    const state = v.applyMovement(empty, {
      itemId: 'PRIOQ43',
      transactionDate: '2026-01-01',
      movementType: 'opening_balance',
      quantityDelta: -31200,
      unitValue: 1.426748,
    });
    expect(state.quantity).toBe(-31200);
    expect(state.pmA).toBeCloseTo(1.426748, 6);
    expect(state.pmB).toBeCloseTo(1.426748, 6);
    expect(state.pmC).toBeCloseTo(1.426748, 6);
  });

  it('aquisicao via exercicio de PUT abate premio em PM B3 mas nao em Estrito', () => {
    const after = v.applyMovement(empty, {
      itemId: 'PRIO3',
      transactionDate: '2026-02-15',
      movementType: 'acquisition',
      quantityDelta: 1000,
      unitValue: 43.0,
      metadata: {
        acquired_via_put_exercise: true,
        put_premium_used: 1426.74,
      },
    });
    expect(after.pmA).toBeCloseTo(43.0, 4);
    expect(after.pmB).toBeCloseTo(43.0 - 1426.74 / 1000, 4);
    expect(after.pmC).toBeCloseTo(43.0 - 1426.74 / 1000, 4);
  });

  it('CALL vendida aberta abate prêmio em PM Gerencial mas nao em B3', () => {
    const after = v.applyMovement(empty, {
      itemId: 'PRIO3',
      transactionDate: '2026-02-15',
      movementType: 'acquisition',
      quantityDelta: 1000,
      unitValue: 43.0,
      metadata: {
        open_call_premium_total: 626.91,
      },
    });
    expect(after.pmA).toBeCloseTo(43.0, 4);
    expect(after.pmB).toBeCloseTo(43.0, 4);
    expect(after.pmC).toBeCloseTo(43.0 - 626.91 / 1000, 4);
  });

  describe('cost_adjustment (custo absorvido apos a operacao geradora)', () => {
    /**
     * Cenario base: 1000 LFT-20310301 a R$ 16,00 (R$ 16.000 de custo).
     * Em D+1, IRRF de R$ 24,00 cai no extrato e deve ser absorvido pelo
     * preco estrito (pmA) e gerencial (pmC), mas nao pelo B3 (pmB).
     */
    const baseLft = (): PositionState => ({
      quantity: 1000,
      pmA: 16.0,
      pmB: 16.0,
      pmC: 16.0,
      acquisitionValue: 16000,
      currentValue: 16000,
    });

    it('aumenta pmA e pmC; nao mexe em pmB (default applies_to_b3=false)', () => {
      const after = v.applyMovement(baseLft(), {
        itemId: 'LFT-20310301',
        transactionDate: '2026-01-10',
        movementType: 'cost_adjustment',
        quantityDelta: 0,
        unitValue: 24,
      });
      expect(after.quantity).toBe(1000);
      expect(after.acquisitionValue).toBeCloseTo(16024, 4);
      expect(after.pmA).toBeCloseTo(16.024, 6);
      expect(after.pmC).toBeCloseTo(16.024, 6);
      expect(after.pmB).toBeCloseTo(16.0, 6);
      expect(after.currentValue).toBeCloseTo(16024, 4);
    });

    it('aumenta tambem pmB quando metadata.applies_to_b3 = true', () => {
      const after = v.applyMovement(baseLft(), {
        itemId: 'LFT-20310301',
        transactionDate: '2026-01-10',
        movementType: 'cost_adjustment',
        quantityDelta: 0,
        unitValue: 24,
        metadata: { applies_to_b3: true },
      });
      expect(after.pmA).toBeCloseTo(16.024, 6);
      expect(after.pmB).toBeCloseTo(16.024, 6);
      expect(after.pmC).toBeCloseTo(16.024, 6);
    });

    it('com quantity zero deixa o estado inalterado (sem divisao por zero)', () => {
      const after = v.applyMovement(empty, {
        itemId: 'LFT-X',
        transactionDate: '2026-01-10',
        movementType: 'cost_adjustment',
        quantityDelta: 0,
        unitValue: 24,
      });
      expect(after.quantity).toBe(0);
      expect(after.acquisitionValue).toBe(0);
      expect(after.pmA).toBe(0);
    });

    it('preserva pmC ja descontado por put exercise (gerencial)', () => {
      const initial: PositionState = {
        quantity: 1000,
        pmA: 43.0,
        pmB: 43.0 - 1.42674,
        pmC: 43.0 - 1.42674,
        acquisitionValue: 43000,
        currentValue: 43000,
      };
      const after = v.applyMovement(initial, {
        itemId: 'PRIO3',
        transactionDate: '2026-02-20',
        movementType: 'cost_adjustment',
        quantityDelta: 0,
        unitValue: 50, // multa rateada absorvida proporcionalmente
      });
      expect(after.acquisitionValue).toBeCloseTo(43050, 4);
      expect(after.pmA).toBeCloseTo(43.05, 6);
      expect(after.pmB).toBeCloseTo(43.0 - 1.42674, 6); // pmB nao mexe
      expect(after.pmC).toBeCloseTo(43.0 - 1.42674 + 0.05, 6);
    });
  });
});
