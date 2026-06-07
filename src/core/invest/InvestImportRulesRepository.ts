import type { CoCeoDataGateway, UserContext } from '../dal';
import type { InvestImportRule } from './ledgerTypes';

/**
 * Repositório de regras de importação do extrato por corretora.
 *
 * Carrega de invest_import_rules e fornece ao BtgExtractLineParser
 * e futuros parsers de outras corretoras.
 *
 * Cache por processo — regras mudam apenas via migration/admin.
 * Use clearCache() em testes ou após atualização administrativa.
 */
export class InvestImportRulesRepository {
  private cache: InvestImportRule[] | null = null;

  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Carrega as regras ativas para um broker específico.
   * Inclui regras com broker_id='*' (universais) + broker_id=brokerId.
   * Resultado ordenado por priority ASC (menor = maior prioridade).
   */
  async loadForBroker(ctx: UserContext, brokerId: string): Promise<InvestImportRule[]> {
    const all = await this.loadAll(ctx);
    return all
      .filter((r) => r.broker_id === brokerId || r.broker_id === '*')
      .sort((a, b) => a.priority - b.priority);
  }

  clearCache(): void {
    this.cache = null;
  }

  private async loadAll(ctx: UserContext): Promise<InvestImportRule[]> {
    if (this.cache !== null) return this.cache;
    try {
      const rows = await this.gateway.findWhere(ctx, 'invest_import_rules', { is_active: 1 });
      this.cache = rows as unknown as InvestImportRule[];
    } catch {
      // Tabela ainda não existe — retorna vazio (parser usa lógica interna de fallback)
      this.cache = [];
    }
    return this.cache;
  }
}
