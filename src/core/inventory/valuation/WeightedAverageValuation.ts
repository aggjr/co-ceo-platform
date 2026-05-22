import type {
  InventoryValuation,
  PositionState,
  RecordMovementInput,
} from '../types';

/**
 * Preco medio ponderado classico. Aplica-se a renda fixa, posicoes simples
 * onde nao ha distincao entre custo "estrito", "B3" ou "gerencial".
 *
 * Apenas pmA eh atualizado; pmB e pmC ficam null.
 */
export class WeightedAverageValuation implements InventoryValuation {
  readonly methodCode = 'weighted_avg';

  applyMovement(state: PositionState, movement: RecordMovementInput): PositionState {
    const next: PositionState = {
      quantity: state.quantity + movement.quantityDelta,
      pmA: state.pmA,
      pmB: null,
      pmC: null,
      acquisitionValue: state.acquisitionValue,
      currentValue: state.currentValue,
    };

    if (movement.movementType === 'revaluation') {
      next.pmA = movement.unitValue;
      next.currentValue = next.quantity * movement.unitValue;
      return next;
    }

    /**
     * Ajuste de custo: incorpora um custo absoluto (unitValue) sem alterar
     * quantidade. Usado p/ taxas/IRRF que chegam fora da linha original.
     * Veja docstring em MovementType.
     */
    if (movement.movementType === 'cost_adjustment') {
      if (state.quantity <= 0) {
        return next;
      }
      next.acquisitionValue = state.acquisitionValue + movement.unitValue;
      next.pmA = next.acquisitionValue / state.quantity;
      next.currentValue = state.quantity * next.pmA;
      return next;
    }

    if (movement.quantityDelta > 0) {
      const oldCost = state.quantity * state.pmA;
      const addedCost = movement.quantityDelta * movement.unitValue;
      const totalQty = next.quantity;
      if (totalQty <= 0) {
        next.pmA = 0;
      } else {
        next.pmA = (oldCost + addedCost) / totalQty;
      }
      next.acquisitionValue = state.acquisitionValue + addedCost;
      next.currentValue = totalQty * next.pmA;
      return next;
    }

    if (movement.quantityDelta < 0) {
      if (next.quantity <= 0) {
        next.pmA = 0;
        next.acquisitionValue = 0;
        next.currentValue = 0;
        return next;
      }
      next.acquisitionValue = next.quantity * next.pmA;
      next.currentValue = next.quantity * next.pmA;
      return next;
    }

    next.acquisitionValue = next.quantity * next.pmA;
    next.currentValue = next.quantity * next.pmA;
    return next;
  }
}
