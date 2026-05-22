import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import type { BusinessEventRegistry } from './BusinessEventRegistry';
import type { EventReconciliationReport } from './types';

/**
 * Conciliacao: verifica que o agregado das pernas (caixa + custodia) bate
 * com o header canonico. Usado como gate de qualidade pos-import e como
 * varredura periodica de saude do nucleo patrimonial.
 *
 * Regras atuais:
 *   1. SUM(financial_legs_cleared+pending) deve bater com header.total_net
 *      (com tolerancia de 0.01). Quando total_net=0 a regra vira "tem que
 *      ter pelo menos 1 perna" — eh o caso do opening_balance.
 *   2. Pelo menos 1 perna (custodia OU caixa) deve existir. Header sem
 *      pernas eh um defeito (alguem criou o header mas falhou em gravar
 *      as pernas).
 *   3. Pernas com status='cancelled' nao entram na soma.
 */
const TOLERANCE = 0.01;

export class BusinessEventReconciler {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly registry: BusinessEventRegistry
  ) {}

  async reconcileEvent(
    ctx: UserContext,
    eventId: string
  ): Promise<EventReconciliationReport> {
    const event = await this.registry.findById(ctx, eventId);
    if (!event) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `business_events ${eventId} nao encontrado`,
        404
      );
    }
    const { patrimonyLegs, financialLegs } = await this.registry.listLegs(
      ctx,
      eventId
    );

    let totalNetLegs = 0;
    for (const leg of financialLegs) {
      const status = String((leg as { status?: string }).status ?? 'cleared');
      if (status === 'cancelled') continue;
      const direction = String((leg as { direction?: string }).direction ?? 'in');
      const amount = Number((leg as { amount?: number | string }).amount ?? 0);
      totalNetLegs += direction === 'in' ? amount : -amount;
    }
    const totalNetHeader = Number(event.total_net);
    const delta = round2(totalNetLegs - totalNetHeader);

    const issues: string[] = [];
    const headerExpectsSum = Math.abs(totalNetHeader) > TOLERANCE;
    if (headerExpectsSum && Math.abs(delta) > TOLERANCE) {
      issues.push(
        `Soma das pernas de caixa (${round2(totalNetLegs)}) nao bate com header.total_net (${round2(totalNetHeader)}). delta=${delta}`
      );
    }
    if (patrimonyLegs.length === 0 && financialLegs.length === 0) {
      issues.push(`Header sem pernas (nem custodia nem caixa).`);
    }
    if (event.voided_at) {
      issues.push(`Header esta voided (em ${event.voided_at}). Pernas deveriam ter sido estornadas.`);
    }

    return {
      eventId,
      consistent: issues.length === 0,
      totalNetHeader: round2(totalNetHeader),
      totalNetLegs: round2(totalNetLegs),
      delta,
      patrimonyLegCount: patrimonyLegs.length,
      financialLegCount: financialLegs.length,
      issues,
    };
  }

  /**
   * Asercao estrita: lanca GatewayError se a conciliacao nao bate. Use em
   * gates pos-import quando voce quer travar o pipeline.
   */
  async assertConsistent(ctx: UserContext, eventId: string): Promise<void> {
    const report = await this.reconcileEvent(ctx, eventId);
    if (!report.consistent) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        `business_events ${eventId} inconsistente: ${report.issues.join('; ')}`,
        422
      );
    }
  }

  /**
   * Varre pernas (custodia OU caixa) sem header em um intervalo. Util como
   * audit de saude: o ideal eh sempre devolver 0. Pernas pre-migracao 16 sao
   * naturalmente orfas — use o backfill antes de chamar isso.
   *
   * Range default: 1900-01-01..2999-12-31 (varredura total). Limite default
   * 1000 por lado pra nao explodir tela.
   */
  async findOrphanLegs(
    ctx: UserContext,
    options: { transactionDateFrom?: string; transactionDateTo?: string; limit?: number } = {}
  ): Promise<{
    patrimony: Record<string, unknown>[];
    financial: Record<string, unknown>[];
  }> {
    if (!ctx.organizationId) {
      throw new GatewayError(
        'ACCESS_DENIED',
        'findOrphanLegs exige contexto com organization_id (escopo tenant).',
        403
      );
    }
    const limit = options.limit ?? 1000;
    const from = options.transactionDateFrom ?? '1900-01-01';
    const to = options.transactionDateTo ?? '2999-12-31';
    const params = [ctx.organizationId, from, to, limit];
    const [patrimony, financial] = await Promise.all([
      this.gateway.readQuery(ctx, 'business_event_orphan_patrimony_legs', params),
      this.gateway.readQuery(ctx, 'business_event_orphan_financial_legs', params),
    ]);
    return { patrimony, financial };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
