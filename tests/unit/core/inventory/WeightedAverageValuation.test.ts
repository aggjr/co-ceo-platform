import { WeightedAverageValuation } from '../../../../src/core/inventory/valuation/WeightedAverageValuation';
import type { PositionState } from '../../../../src/core/inventory/types';

const empty: PositionState = {
  quantity: 0,
  pmA: 0,
  pmB: null,
  pmC: null,
  acquisitionValue: 0,
  currentValue: 0,
};

describe('WeightedAverageValuation', () => {
  const v = new WeightedAverageValuation();

  it('opening_balance positivo define preco medio', () => {
    const state = v.applyMovement(empty, {
      itemId: 'x',
      transactionDate: '2026-01-01',
      movementType: 'opening_balance',
      quantityDelta: 100,
      unitValue: 50,
    });
    expect(state.quantity).toBe(100);
    expect(state.pmA).toBe(50);
    expect(state.pmB).toBeNull();
    expect(state.currentValue).toBe(5000);
  });

  it('aquisicao adicional pondera o PM', () => {
    let state = v.applyMovement(empty, {
      itemId: 'x',
      transactionDate: '2026-01-01',
      movementType: 'acquisition',
      quantityDelta: 100,
      unitValue: 50,
    });
    state = v.applyMovement(state, {
      itemId: 'x',
      transactionDate: '2026-02-01',
      movementType: 'acquisition',
      quantityDelta: 100,
      unitValue: 60,
    });
    expect(state.quantity).toBe(200);
    expect(state.pmA).toBeCloseTo(55, 4);
    expect(state.acquisitionValue).toBeCloseTo(11000, 4);
  });

  it('venda parcial mantem o PM', () => {
    let state = v.applyMovement(empty, {
      itemId: 'x',
      transactionDate: '2026-01-01',
      movementType: 'acquisition',
      quantityDelta: 100,
      unitValue: 50,
    });
    state = v.applyMovement(state, {
      itemId: 'x',
      transactionDate: '2026-02-01',
      movementType: 'disposition',
      quantityDelta: -40,
      unitValue: 70,
    });
    expect(state.quantity).toBe(60);
    expect(state.pmA).toBeCloseTo(50, 4);
  });

  it('venda total zera estado', () => {
    let state = v.applyMovement(empty, {
      itemId: 'x',
      transactionDate: '2026-01-01',
      movementType: 'acquisition',
      quantityDelta: 100,
      unitValue: 50,
    });
    state = v.applyMovement(state, {
      itemId: 'x',
      transactionDate: '2026-02-01',
      movementType: 'disposition',
      quantityDelta: -100,
      unitValue: 70,
    });
    expect(state.quantity).toBe(0);
    expect(state.pmA).toBe(0);
    expect(state.acquisitionValue).toBe(0);
  });

  it('revaluation substitui PM sem mudar quantidade', () => {
    let state = v.applyMovement(empty, {
      itemId: 'x',
      transactionDate: '2026-01-01',
      movementType: 'acquisition',
      quantityDelta: 100,
      unitValue: 50,
    });
    state = v.applyMovement(state, {
      itemId: 'x',
      transactionDate: '2026-02-01',
      movementType: 'revaluation',
      quantityDelta: 0,
      unitValue: 65,
    });
    expect(state.quantity).toBe(100);
    expect(state.pmA).toBe(65);
    expect(state.currentValue).toBe(6500);
  });
});
