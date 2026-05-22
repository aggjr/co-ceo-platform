import type {
  InventoryValuation,
  PositionState,
  RecordMovementInput,
} from '../../core/inventory';

/**
 * Estrategia de valoracao do INVEST: 3 precos paralelos.
 *
 *   pmA = Estrito    : custo de aquisicao puro, sem qualquer abatimento.
 *   pmB = B3         : igual ao estrito, mas abate premio de PUT quando a
 *                      compra veio via exercicio (metadata.acquired_via_put_exercise).
 *   pmC = Gerencial  : igual ao B3, e adicionalmente abate prêmios de CALLs
 *                      vendidas em aberto sobre a posicao
 *                      (metadata.open_call_premium_total — apurado pelo
 *                      orquestrador InvestOperations).
 *
 * A estrategia recalcula sobre o lote inteiro a cada movimento: o estado
 * resultante eh sempre "o lote tem N unidades com tres PMs unicos".
 */
export class ThreePricesValuation implements InventoryValuation {
  readonly methodCode = 'three_prices_invest';

  applyMovement(state: PositionState, movement: RecordMovementInput): PositionState {
    const meta = (movement.metadata ?? {}) as {
      acquired_via_put_exercise?: boolean;
      put_premium_used?: number;
      open_call_premium_total?: number;
      cumulative_put_discount?: number;
      applies_to_b3?: boolean;
    };

    const next: PositionState = {
      quantity: state.quantity + movement.quantityDelta,
      pmA: state.pmA,
      pmB: state.pmB ?? state.pmA,
      pmC: state.pmC ?? state.pmA,
      acquisitionValue: state.acquisitionValue,
      currentValue: state.currentValue,
    };

    /**
     * Ajuste de custo: incorpora um custo (positivo) no item sem alterar
     * quantidade. Usado para IRRF de TD, taxa BTC, IRRF de opcao etc, que
     * caem em data/fonte diferentes da operacao geradora.
     *
     * Regra atual (a confirmar com pesquisa B3/RFB):
     *   - pmA (estrito)    : sempre absorve.
     *   - pmC (gerencial)  : sempre absorve.
     *   - pmB (B3)         : absorve somente se metadata.applies_to_b3 === true.
     */
    if (movement.movementType === 'cost_adjustment') {
      if (state.quantity <= 0) {
        return next;
      }
      const addedCost = movement.unitValue;
      next.acquisitionValue = state.acquisitionValue + addedCost;
      next.pmA = next.acquisitionValue / state.quantity;
      const pmCOld = state.pmC ?? state.pmA;
      const oldCostC = state.quantity * pmCOld;
      next.pmC = (oldCostC + addedCost) / state.quantity;
      if (meta.applies_to_b3) {
        const pmBOld = state.pmB ?? state.pmA;
        const oldCostB = state.quantity * pmBOld;
        next.pmB = (oldCostB + addedCost) / state.quantity;
      }
      next.currentValue = state.quantity * next.pmA;
      return next;
    }

    if (movement.movementType === 'revaluation') {
      next.pmA = movement.unitValue;
      next.pmB = movement.unitValue;
      next.pmC = movement.unitValue;
      next.currentValue = next.quantity * movement.unitValue;
      return next;
    }

    if (movement.quantityDelta > 0 || movement.movementType === 'opening_balance') {
      const oldCost = state.quantity * state.pmA;
      const addedCost = movement.quantityDelta * movement.unitValue;
      const totalQty = next.quantity;
      if (totalQty === 0) {
        next.pmA = 0;
        next.pmB = 0;
        next.pmC = 0;
      } else {
        next.pmA = (oldCost + addedCost) / totalQty;
        const pmBOld = state.pmB ?? state.pmA;
        const oldCostB = state.quantity * pmBOld;
        const putDiscount = meta.acquired_via_put_exercise ? meta.put_premium_used ?? 0 : 0;
        next.pmB = (oldCostB + addedCost - putDiscount) / totalQty;
        const openCallDiscount = meta.open_call_premium_total ?? 0;
        const cumulativePutDiscount = meta.cumulative_put_discount ?? putDiscount;
        next.pmC =
          (oldCost + addedCost - cumulativePutDiscount - openCallDiscount) / totalQty;
      }
      next.acquisitionValue = state.acquisitionValue + addedCost;
      next.currentValue = totalQty * next.pmA;
      return next;
    }

    if (movement.quantityDelta < 0) {
      if (next.quantity <= 0) {
        next.pmA = 0;
        next.pmB = 0;
        next.pmC = 0;
        next.acquisitionValue = 0;
        next.currentValue = 0;
        return next;
      }
      next.acquisitionValue = next.quantity * next.pmA;
      next.currentValue = next.quantity * next.pmA;
      return next;
    }

    return next;
  }
}
