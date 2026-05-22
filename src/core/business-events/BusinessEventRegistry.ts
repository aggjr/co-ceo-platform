import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext, SecurePayload } from '../dal';
import { GatewayError } from '../dal/errors';
import type {
  BusinessEventLegs,
  BusinessEventRow,
  CreateBusinessEventInput,
  LegKind,
} from './types';

/**
 * Registry do header canonico (business_events). E o "fato gerador" que liga
 * as pernas de custodia (patrimony_ledger_entries) e as pernas de caixa
 * (financial_ledger_entries).
 *
 * Idempotencia: ensureByRef busca por (organization, source_module, source_ref,
 * revision_no=1) e devolve o existente em vez de duplicar. Util pra reimport
 * de mesma nota / NFe / pedido.
 *
 * Imutabilidade: header fechado nao sofre UPDATE. Correcao = NOVO header
 * (revision_no=2) com supersedes_event_id apontando o anterior. Use `void`
 * para anular um header sem precisar criar replica.
 */
export class BusinessEventRegistry {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /** Cria um header novo (sem checar idempotencia). */
  async create(
    ctx: UserContext,
    input: CreateBusinessEventInput,
    options: { supersedesEventId?: string | null; revisionNo?: number } = {}
  ): Promise<BusinessEventRow> {
    const id = randomUUID();
    const payload: SecurePayload = {
      id,
      source_module: input.sourceModule,
      event_kind: input.eventKind,
      occurred_on: input.occurredOn,
      settles_on: input.settlesOn ?? null,
      source_ref: input.sourceRef ?? null,
      counterparty: input.counterparty ?? null,
      total_gross: input.totalGross ?? 0,
      total_costs: input.totalCosts ?? 0,
      total_net: input.totalNet ?? 0,
      source_system: input.sourceSystem,
      source_version: input.sourceVersion ?? null,
      recorded_by_user_id: input.recordedByUserId ?? null,
      revision_no: options.revisionNo ?? 1,
      supersedes_event_id: options.supersedesEventId ?? null,
      metadata:
        input.metadata == null
          ? null
          : typeof input.metadata === 'string'
          ? input.metadata
          : JSON.stringify(input.metadata),
    };
    await this.gateway.insert(ctx, 'business_events', payload);
    const row = (await this.gateway.findById(ctx, 'business_events', id)) as BusinessEventRow | null;
    if (!row) {
      throw new GatewayError('RECORD_NOT_FOUND', `Falha ao criar business_events ${id}`, 500);
    }
    return row;
  }

  /**
   * Procura header existente por (org, module, ref, revision=1). Se nao
   * existir, cria. Garantia: chamadas paralelas com mesmo ref devolvem o mesmo
   * header (idempotente desde que o UNIQUE constraint exista).
   */
  async ensureByRef(
    ctx: UserContext,
    input: CreateBusinessEventInput
  ): Promise<{ event: BusinessEventRow; created: boolean }> {
    if (!input.sourceRef) {
      const event = await this.create(ctx, input);
      return { event, created: true };
    }
    const existing = (await this.gateway.findWhere(
      ctx,
      'business_events',
      {
        source_module: input.sourceModule,
        source_ref: input.sourceRef,
        revision_no: 1,
      },
      { limit: 1 }
    )) as BusinessEventRow[];
    if (existing.length > 0) {
      return { event: existing[0]!, created: false };
    }
    const event = await this.create(ctx, input);
    return { event, created: true };
  }

  async findById(ctx: UserContext, id: string): Promise<BusinessEventRow | null> {
    return (await this.gateway.findById(ctx, 'business_events', id)) as BusinessEventRow | null;
  }

  async findByRef(
    ctx: UserContext,
    sourceModule: string,
    sourceRef: string,
    revisionNo: number = 1
  ): Promise<BusinessEventRow | null> {
    const rows = (await this.gateway.findWhere(
      ctx,
      'business_events',
      {
        source_module: sourceModule,
        source_ref: sourceRef,
        revision_no: revisionNo,
      },
      { limit: 1 }
    )) as BusinessEventRow[];
    return rows[0] ?? null;
  }

  /**
   * Cria uma nova revisao apontando uma anterior. A anterior fica viva
   * (trilha completa); querys passam a ler a "ponta" via revision_no MAX
   * por source_ref.
   */
  async amend(
    ctx: UserContext,
    previousEventId: string,
    input: CreateBusinessEventInput
  ): Promise<BusinessEventRow> {
    const prev = await this.findById(ctx, previousEventId);
    if (!prev) {
      throw new GatewayError(
        'RECORD_NOT_FOUND',
        `business_events ${previousEventId} nao encontrado`,
        404
      );
    }
    return this.create(ctx, input, {
      supersedesEventId: previousEventId,
      revisionNo: prev.revision_no + 1,
    });
  }

  /** Marca um header como anulado (estorno explicito). */
  async voidEvent(
    ctx: UserContext,
    eventId: string,
    voidedByUserId: string,
    reason: string
  ): Promise<void> {
    await this.gateway.update(ctx, 'business_events', eventId, {
      voided_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      voided_by_user_id: voidedByUserId,
      void_reason: reason,
    });
  }

  // ==========================================================================
  // RASTREABILIDADE
  // ==========================================================================

  /**
   * Devolve todas as pernas (custodia + caixa) vinculadas ao header. Ordem
   * cronologica + ordem de criacao (mesmo criterio do InventoryLedger).
   *
   * Limite padrao: 5000 pernas por lado. Hoje uma nota BTG tipica tem < 30
   * pernas; o teto eh defensivo. Estoure aqui se virmos casos reais > 5000
   * (provavelmente indica bug de agrupamento).
   */
  async listLegs(
    ctx: UserContext,
    eventId: string,
    options: { limit?: number } = {}
  ): Promise<BusinessEventLegs> {
    const limit = options.limit ?? 5000;
    const filters: SecurePayload = { business_event_id: eventId };
    const [patrimony, financial] = await Promise.all([
      this.gateway.findWhere(ctx, 'patrimony_ledger_entries', filters, { limit }),
      this.gateway.findWhere(ctx, 'financial_ledger_entries', filters, { limit }),
    ]);
    return {
      patrimonyLegs: sortLegs(patrimony),
      financialLegs: sortLegs(financial),
    };
  }

  /**
   * A partir de um ID de perna, devolve o header (ou null se a perna nao
   * tiver business_event_id — caso de dado pre-migracao).
   */
  async findByLegId(
    ctx: UserContext,
    legId: string,
    kind: LegKind
  ): Promise<BusinessEventRow | null> {
    const table =
      kind === 'patrimony' ? 'patrimony_ledger_entries' : 'financial_ledger_entries';
    const row = (await this.gateway.findById(ctx, table, legId)) as
      | { business_event_id: string | null }
      | null;
    if (!row || !row.business_event_id) return null;
    return this.findById(ctx, row.business_event_id);
  }

  /**
   * Cadeia completa de revisoes pra um (source_module, source_ref). Util pra
   * auditoria: ver quem corrigiu o que e quando. Ordenado por revision_no.
   */
  async listRevisions(
    ctx: UserContext,
    sourceModule: string,
    sourceRef: string
  ): Promise<BusinessEventRow[]> {
    const rows = (await this.gateway.findWhere(
      ctx,
      'business_events',
      { source_module: sourceModule, source_ref: sourceRef },
      { limit: 200 }
    )) as BusinessEventRow[];
    return rows
      .slice()
      .sort((a, b) => a.revision_no - b.revision_no);
  }

  /**
   * Atalho: ponta (ultima revisao viva) de uma source_ref. Devolve null se
   * nao existir nada.
   */
  async findHead(
    ctx: UserContext,
    sourceModule: string,
    sourceRef: string
  ): Promise<BusinessEventRow | null> {
    const chain = await this.listRevisions(ctx, sourceModule, sourceRef);
    return chain.length ? chain[chain.length - 1]! : null;
  }
}

/**
 * Ordenacao canonica de pernas: data crescente, criando_at crescente. Empata
 * por id quando os timestamps coincidem (raro, mas determinismo importa).
 */
function sortLegs<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows
    .slice()
    .filter((r) => !(r as { deleted_at?: string | null }).deleted_at)
    .sort((a, b) => {
      const da = String(a.transaction_date ?? '');
      const db = String(b.transaction_date ?? '');
      if (da !== db) return da < db ? -1 : 1;
      const ca = String((a as { created_at?: string }).created_at ?? '');
      const cb = String((b as { created_at?: string }).created_at ?? '');
      if (ca !== cb) return ca < cb ? -1 : 1;
      const ia = String(a.id ?? '');
      const ib = String(b.id ?? '');
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
}
