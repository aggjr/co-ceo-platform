import type { UserContext } from '../../dal';
import { GatewayError } from '../../dal/errors';
import type { ModuleCategories } from '../../module-registry/ModuleCategories';
import type { InventoryValuation } from '../types';
import { WeightedAverageValuation } from './WeightedAverageValuation';

/**
 * Fabrica de estrategias de valoracao.
 *
 * Lookup pelo method_code do registry (module_valuation_methods). Cada
 * modulo registra sua propria estrategia chamando `register(methodCode, factory)`.
 * Estrategias do nucleo ja vem registradas.
 */
export class ValuationFactory {
  private readonly builders = new Map<string, () => InventoryValuation>();

  constructor(private readonly categories: ModuleCategories) {
    this.register('weighted_avg', () => new WeightedAverageValuation());
  }

  register(methodCode: string, build: () => InventoryValuation): void {
    this.builders.set(methodCode, build);
  }

  async build(ctx: UserContext, methodCode: string): Promise<InventoryValuation> {
    await this.categories.resolveValuation(ctx, methodCode);
    const builder = this.builders.get(methodCode);
    if (!builder) {
      throw new GatewayError(
        'UNKNOWN_VALUATION_METHOD',
        `Metodo de valoracao ${methodCode} registrado em module_valuation_methods nao tem implementacao TS registrada na ValuationFactory.`,
        500
      );
    }
    return builder();
  }
}
