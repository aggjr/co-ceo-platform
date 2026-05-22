import { randomUUID } from 'crypto';
import type {
  CoCeoDataGateway,
  UserContext,
  SecurePayload,
} from '../../../../src/core/dal';

/**
 * Gateway in-memory para testes. Implementa apenas o subset usado pelo
 * BusinessEventRegistry / Reconciler / InvestOperations: insert, update,
 * findById, findWhere, softDelete, readQuery. Tudo escopado por organization_id.
 *
 * Limitacoes propositais:
 *   - sem RLS real; apenas filtra por organizationId do contexto.
 *   - readQuery serve so as chaves business_event_orphan_*.
 */
export type InMemoryRow = Record<string, unknown> & {
  id: string;
  organization_id?: string | null;
  deleted_at?: string | null;
  created_at?: string;
};

export class InMemoryGateway {
  private readonly tables = new Map<string, Map<string, InMemoryRow>>();
  private clock = 0;

  private getTable(name: string): Map<string, InMemoryRow> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private nextTs(): string {
    this.clock += 1;
    return new Date(2026, 0, 1, 0, 0, 0, this.clock).toISOString();
  }

  async insert(
    ctx: UserContext,
    table: string,
    payload: SecurePayload
  ): Promise<{ insertId: number | null; recordId: string; affectedRows: number }> {
    const t = this.getTable(table);
    const id = String(payload.id ?? randomUUID());
    const row: InMemoryRow = {
      ...(payload as Record<string, unknown>),
      id,
      organization_id: ctx.organizationId ?? null,
      created_at: this.nextTs(),
      updated_at: this.nextTs(),
      deleted_at: null,
    };
    t.set(id, row);
    return { insertId: null, recordId: id, affectedRows: 1 };
  }

  async update(
    ctx: UserContext,
    table: string,
    id: string,
    payload: SecurePayload
  ): Promise<void> {
    const t = this.getTable(table);
    const row = t.get(id);
    if (!row) throw new Error(`[inMemoryGateway] update: ${table}/${id} nao encontrado`);
    if (row.organization_id && ctx.organizationId && row.organization_id !== ctx.organizationId) {
      throw new Error(`[inMemoryGateway] update: org mismatch`);
    }
    Object.assign(row, payload, { updated_at: this.nextTs() });
  }

  async softDelete(ctx: UserContext, table: string, id: string): Promise<void> {
    const t = this.getTable(table);
    const row = t.get(id);
    if (!row) throw new Error(`[inMemoryGateway] softDelete: ${table}/${id} nao encontrado`);
    if (row.organization_id && ctx.organizationId && row.organization_id !== ctx.organizationId) {
      throw new Error(`[inMemoryGateway] softDelete: org mismatch`);
    }
    row.deleted_at = this.nextTs();
  }

  async findById(ctx: UserContext, table: string, id: string): Promise<InMemoryRow | null> {
    const t = this.tables.get(table);
    if (!t) return null;
    const row = t.get(id);
    if (!row || row.deleted_at) return null;
    if (row.organization_id && ctx.organizationId && row.organization_id !== ctx.organizationId) {
      return null;
    }
    return { ...row };
  }

  async findWhere(
    ctx: UserContext,
    table: string,
    filters: SecurePayload,
    options?: { limit?: number; columns?: string[] }
  ): Promise<InMemoryRow[]> {
    const t = this.tables.get(table);
    if (!t) return [];
    const limit = options?.limit ?? 500;
    const out: InMemoryRow[] = [];
    for (const row of t.values()) {
      if (row.deleted_at) continue;
      if (row.organization_id && ctx.organizationId && row.organization_id !== ctx.organizationId) {
        continue;
      }
      let match = true;
      for (const [k, v] of Object.entries(filters)) {
        if (row[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) {
        out.push({ ...row });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async readQuery(
    _ctx: UserContext,
    queryKey: string,
    params: unknown[]
  ): Promise<InMemoryRow[]> {
    const [orgId, from, to, limit] = params as [string, string, string, number];
    const table =
      queryKey === 'business_event_orphan_patrimony_legs'
        ? 'patrimony_ledger_entries'
        : queryKey === 'business_event_orphan_financial_legs'
        ? 'financial_ledger_entries'
        : null;
    if (!table) throw new Error(`[inMemoryGateway] readQuery: ${queryKey} nao suportada`);
    const t = this.tables.get(table);
    if (!t) return [];
    const out: InMemoryRow[] = [];
    for (const row of t.values()) {
      if (row.deleted_at) continue;
      if (row.business_event_id) continue;
      if (row.organization_id !== orgId) continue;
      const date = String(row.transaction_date ?? '');
      if (date < from || date > to) continue;
      out.push({ ...row });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ===== Helpers de teste =====

  dump(table: string): InMemoryRow[] {
    return Array.from(this.getTable(table).values()).map((r) => ({ ...r }));
  }

  count(table: string, predicate?: (row: InMemoryRow) => boolean): number {
    return Array.from(this.getTable(table).values()).filter(
      (r) => !r.deleted_at && (!predicate || predicate(r))
    ).length;
  }
}

export function castGateway(g: InMemoryGateway): CoCeoDataGateway {
  return g as unknown as CoCeoDataGateway;
}
