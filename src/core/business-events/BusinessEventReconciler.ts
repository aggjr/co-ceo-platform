import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import type { BusinessEventRegistry } from './BusinessEventRegistry';
import type { EconomicConservationReport, EventReconciliationReport } from './types';

/**
 * Conciliacao: verifica que o agregado das pernas (caixa + custodia) bate
 * com o header canonico. Usado como gate de qualidade pos-import e como
 * varredura periodica de saude do nucleo patrimonial.
 *
 * Regras atuais:
 *   1. SUM(financial_legs_cleared+pending) deve bater com header.total_net
 *      (com tolerancia de 0.01). Quando total_net=0 a regra vira "tem que
 *      ter pelo menos 1 perna" — eh o caso do opening_balance.
 *   2. Todo header precisa representar uma composicao contabil completa:
 *      custodia+caixa, duas pernas de custodia, ou duas pernas financeiras.
 *      Um header com uma unica perna eh sempre pendente de pareamento/correcao.
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
    if (!hasCompleteLegComposition(event.event_kind, patrimonyLegs.length, financialLegs.length, financialLegs)) {
      issues.push(
        `Composicao incompleta de pernas: patrimony=${patrimonyLegs.length}, financial=${financialLegs.length}. ` +
          `Esperado custodia+caixa, unilateral catalogado, ou pending de materializacao.`
      );
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

  /**
   * Conservacao economica: em eventos mistos (custodia + caixa), a soma assinada
   * de total_value patrimonial + movimento financeiro deve fechar em zero.
   * Excecoes declaradas: renda passiva, corporate_action, unknown_invest_event,
   * eventos puramente patrimoniais ou financeiros.
   */
  async reconcileEconomicConservation(
    ctx: UserContext,
    eventId: string
  ): Promise<EconomicConservationReport> {
    const event = await this.registry.findById(ctx, eventId);
    if (!event) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `business_events ${eventId} nao encontrado`,
        404
      );
    }
    const eventKind = String(event.event_kind ?? '');
    const { patrimonyLegs, financialLegs } = await this.registry.listLegs(ctx, eventId);

    if (isEconomicConservationExempt(eventKind, patrimonyLegs.length, financialLegs.length)) {
      return {
        eventId,
        eventKind,
        conserved: true,
        patrimonySignedTotal: 0,
        financialSignedTotal: 0,
        conservationDelta: 0,
        skipped: true,
        skipReason: `event_kind=${eventKind} isento de conservacao economica`,
        issues: [],
      };
    }

    let patrimonySignedTotal = 0;
    for (const leg of patrimonyLegs) {
      patrimonySignedTotal += signedPatrimonyValue(leg);
    }

    let financialSignedTotal = 0;
    for (const leg of financialLegs) {
      const status = String((leg as { status?: string }).status ?? 'cleared');
      if (status === 'cancelled') continue;
      financialSignedTotal += signedFinancialValue(leg);
    }

    const conservationDelta = round2(patrimonySignedTotal + financialSignedTotal);
    const issues: string[] = [];
    if (Math.abs(conservationDelta) > TOLERANCE) {
      issues.push(
        `Conservacao economica violada: patrimonio=${round2(patrimonySignedTotal)}, ` +
          `financeiro=${round2(financialSignedTotal)}, delta=${conservationDelta}`
      );
    }

    return {
      eventId,
      eventKind,
      conserved: issues.length === 0,
      patrimonySignedTotal: round2(patrimonySignedTotal),
      financialSignedTotal: round2(financialSignedTotal),
      conservationDelta,
      skipped: false,
      skipReason: null,
      issues,
    };
  }

  async assertEconomicConservation(ctx: UserContext, eventId: string): Promise<void> {
    const report = await this.reconcileEconomicConservation(ctx, eventId);
    if (!report.skipped && !report.conserved) {
      throw new GatewayError(
        'FINANCIAL_RULE_VIOLATION',
        `business_events ${eventId} viola conservacao economica: ${report.issues.join('; ')}`,
        422
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hasCompleteLegComposition(
  eventKind: string,
  patrimonyCount: number,
  financialCount: number,
  financialLegs: Record<string, unknown>[]
): boolean {
  if (patrimonyCount >= 1 && financialCount >= 1) return true;
  if (patrimonyCount >= 2) return true;
  if (financialCount >= 2) return true;

  const kind = String(eventKind ?? '');
  if (patrimonyCount >= 1 && financialCount === 0) {
    if (kind === 'corporate_action') return true;
  }
  if (financialCount >= 1 && patrimonyCount === 0) {
    if (
      kind === 'cash_movement' ||
      kind === 'cash_yield_event' ||
      kind === 'broker_note_loan' ||
      kind === 'unknown_invest_event'
    ) {
      return true;
    }
  }
  if (patrimonyCount >= 1 && financialCount >= 1) return true;
  if (patrimonyCount >= 1 && financialCount === 1) {
    const hasPending = financialLegs.some(
      (leg) => String((leg as { status?: string }).status ?? '') === 'pending'
    );
    if (hasPending && /broker_note|brokerage_note|treasury_direct|buy|sell/i.test(kind)) {
      return true;
    }
  }
  return false;
}

const PATRIMONIAL_ONLY_EVENT_KINDS = new Set([
  'corporate_action',
  'opening_balance',
]);

const FINANCIAL_ONLY_EVENT_KINDS = new Set([
  'cash_movement',
  'cash_yield_event',
  'broker_note_loan',
  'unknown_invest_event',
]);

export function isEconomicConservationExempt(
  eventKind: string,
  patrimonyCount: number,
  financialCount: number
): boolean {
  const kind = String(eventKind ?? '');
  if (PATRIMONIAL_ONLY_EVENT_KINDS.has(kind) && financialCount === 0) return true;
  if (FINANCIAL_ONLY_EVENT_KINDS.has(kind) && patrimonyCount === 0) return true;
  if (patrimonyCount >= 1 && financialCount === 0) {
    if (kind === 'corporate_action') return true;
  }
  if (financialCount >= 1 && patrimonyCount === 0) {
    if (FINANCIAL_ONLY_EVENT_KINDS.has(kind)) return true;
  }
  return patrimonyCount === 0 || financialCount === 0;
}

function signedPatrimonyValue(leg: Record<string, unknown>): number {
  const movementType = String(
    (leg as { movement_type?: string }).movement_type ??
      (leg as { transaction_type?: string }).transaction_type ??
      ''
  );
  const raw = Math.abs(Number((leg as { total_value?: number | string }).total_value ?? 0));
  if (!Number.isFinite(raw) || raw === 0) return 0;

  switch (movementType) {
    case 'acquisition':
    case 'transfer_in':
    case 'short_close':
      return raw;
    case 'disposition':
    case 'transfer_out':
    case 'short_open':
      return -raw;
    case 'opening_balance':
    case 'split':
    case 'bonus':
    case 'revaluation':
    case 'write_off':
    case 'income_in_kind':
      return 0;
    default:
      return Number((leg as { total_value?: number | string }).total_value ?? 0);
  }
}

function signedFinancialValue(leg: Record<string, unknown>): number {
  const direction = String((leg as { direction?: string }).direction ?? 'in');
  const amount = Number((leg as { amount?: number | string }).amount ?? 0);
  return direction === 'in' ? amount : -amount;
}
