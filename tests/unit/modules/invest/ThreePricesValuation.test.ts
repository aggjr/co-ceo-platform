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
});
