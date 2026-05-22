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
 *
 * REGRA UNIVERSAL DOS PMs (espelha ThreePricesValuation):
 *
 *   PM SO eh recalculado quando o movimento AFASTA a posicao de zero
 *   (lote cresce em valor absoluto). Movimentos que APROXIMAM de zero
 *   nao mexem em PM. Movimentos que CRUZAM zero abrem novo lote do
 *   outro lado com PM = unitValue do movimento.
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
     * Ajuste de custo (qty_delta = 0): incorpora custo absoluto sem alterar
     * quantidade. Veja docstring em MovementType.
     */
    if (movement.movementType === 'cost_adjustment') {
      if (state.quantity <= 0) return next;
      next.acquisitionValue = state.acquisitionValue + movement.unitValue;
      next.pmA = next.acquisitionValue / state.quantity;
      next.currentValue = state.quantity * next.pmA;
      return next;
    }

    if (
      movement.movementType !== 'acquisition' &&
      movement.movementType !== 'disposition' &&
      movement.movementType !== 'opening_balance'
    ) {
      return next;
    }

    const totalQty = next.quantity;

    // (1) LIQUIDOU.
    if (totalQty === 0) {
      next.pmA = 0;
      next.acquisitionValue = 0;
      next.currentValue = 0;
      return next;
    }

    // (2) CRUZOU ZERO.
    if (state.quantity * totalQty < 0) {
      next.pmA = movement.unitValue;
      next.acquisitionValue = totalQty * movement.unitValue;
      next.currentValue = next.acquisitionValue;
      return next;
    }

    // (3) APROXIMA DE ZERO: PM mantido, acquisitionValue proporcional.
    if (Math.abs(totalQty) < Math.abs(state.quantity)) {
      const ratio = totalQty / state.quantity;
      next.acquisitionValue = state.acquisitionValue * ratio;
      next.currentValue = totalQty * next.pmA;
      return next;
    }

    // (4) AFASTA DE ZERO: ponderacao classica.
    const oldCost = state.quantity * state.pmA;
    const addedCost = movement.quantityDelta * movement.unitValue;
    next.pmA = Math.abs((oldCost + addedCost) / totalQty);
    next.acquisitionValue = state.acquisitionValue + addedCost;
    next.currentValue = totalQty * next.pmA;
    return next;
  }
}
