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
 * REGRA UNIVERSAL DOS PMs:
 *
 *   PM SO eh recalculado quando o movimento AFASTA a posicao de zero
 *   (lote cresce em valor absoluto). Movimentos que APROXIMAM de zero
 *   (vendas parciais de long, recompras parciais de short) NAO mexem em
 *   PM — apenas reduzem acquisitionValue proporcionalmente. Movimentos
 *   que CRUZAM zero liquidam o lote antigo e abrem novo lote do outro
 *   lado com PM = unitValue do movimento.
 *
 * Fundamento: lucro/prejuizo de venda/recompra eh evento de DRE, nao de
 * preco medio. PM reflete capital aplicado no lote, nao P&L.
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

    if (movement.movementType === 'revaluation') {
      next.pmA = movement.unitValue;
      next.pmB = movement.unitValue;
      next.pmC = movement.unitValue;
      next.currentValue = next.quantity * movement.unitValue;
      return next;
    }

    /**
     * Ajuste de custo (qty_delta = 0): incorpora custo absoluto sem alterar
     * quantidade. Usado p/ IRRF de TD, taxa BTC, IRRF de opcao etc, que
     * caem em data/fonte diferentes da operacao geradora.
     *
     * REGRA FISCAL (IN RFB 1.585/2015 + Solucoes de Consulta COSIT):
     *   - pmA (estrito)   : sempre absorve.
     *   - pmC (gerencial) : sempre absorve.
     *   - pmB (B3)        : absorve somente se metadata.applies_to_b3 === true.
     */
    if (movement.movementType === 'cost_adjustment') {
      if (state.quantity <= 0) return next;
      const addedCost = movement.unitValue;
      next.acquisitionValue = state.acquisitionValue + addedCost;
      next.pmA = next.acquisitionValue / state.quantity;
      const pmCOld = state.pmC ?? state.pmA;
      next.pmC = (state.quantity * pmCOld + addedCost) / state.quantity;
      if (meta.applies_to_b3) {
        const pmBOld = state.pmB ?? state.pmA;
        next.pmB = (state.quantity * pmBOld + addedCost) / state.quantity;
      }
      next.currentValue = state.quantity * next.pmA;
      return next;
    }

    if (
      movement.movementType !== 'acquisition' &&
      movement.movementType !== 'disposition' &&
      movement.movementType !== 'opening_balance'
    ) {
      // Tipos nao tratados aqui (split/bonus/transfer_*/write_off/income_in_kind):
      // mantem PM, ajusta apenas acquisitionValue conforme delta linear.
      return next;
    }

    const totalQty = next.quantity;

    // (1) LIQUIDOU: posicao zerou.
    if (totalQty === 0) {
      next.pmA = 0;
      next.pmB = 0;
      next.pmC = 0;
      next.acquisitionValue = 0;
      next.currentValue = 0;
      return next;
    }

    // (2) CRUZOU ZERO: lote antigo encerrado, novo lote no outro lado.
    if (state.quantity * totalQty < 0) {
      next.pmA = movement.unitValue;
      next.pmB = movement.unitValue;
      next.pmC = movement.unitValue;
      next.acquisitionValue = totalQty * movement.unitValue;
      next.currentValue = next.acquisitionValue;
      return next;
    }

    // (3) APROXIMA DE ZERO: venda parcial de long, ou recompra parcial de
    // short. PM nao muda; acquisitionValue acompanha proporcionalmente.
    if (Math.abs(totalQty) < Math.abs(state.quantity)) {
      const ratio = totalQty / state.quantity;
      next.acquisitionValue = state.acquisitionValue * ratio;
      // pmA/pmB/pmC ja iniciaram iguais ao estado anterior — mantidos.
      next.currentValue = totalQty * next.pmA;
      return next;
    }

    // (4) AFASTA DE ZERO: compra que aumenta long, abertura de long, abertura
    // de short, ou venda que aumenta short. PM ponderado classico, com os
    // descontos de premios quando aplicaveis.
    const oldCost = state.quantity * state.pmA;
    const addedCost = movement.quantityDelta * movement.unitValue;
    const pmBOld = state.pmB ?? state.pmA;
    const oldCostB = state.quantity * pmBOld;
    const putDiscount = meta.acquired_via_put_exercise ? meta.put_premium_used ?? 0 : 0;
    const openCallDiscount = meta.open_call_premium_total ?? 0;
    const cumulativePutDiscount = meta.cumulative_put_discount ?? putDiscount;

    next.pmA = Math.abs((oldCost + addedCost) / totalQty);
    next.pmB = Math.abs((oldCostB + addedCost - putDiscount) / totalQty);
    next.pmC = Math.abs(
      (oldCost + addedCost - cumulativePutDiscount - openCallDiscount) / totalQty
    );
    next.acquisitionValue = state.acquisitionValue + addedCost;
    next.currentValue = totalQty * next.pmA;
    return next;
  }
}
