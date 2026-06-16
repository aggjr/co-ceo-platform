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

  async deleteMatching(
    ctx: UserContext,
    table: string,
    match: SecurePayload
  ): Promise<number> {
    const t = this.tables.get(table);
    if (!t) return 0;
    const ids: string[] = [];
    for (const [id, row] of t.entries()) {
      if (row.organization_id && ctx.organizationId && row.organization_id !== ctx.organizationId) {
        continue;
      }
      let ok = true;
      for (const [k, v] of Object.entries(match)) {
        if (row[k] !== v) {
          ok = false;
          break;
        }
      }
      if (ok) ids.push(id);
    }
    for (const id of ids) t.delete(id);
    return ids.length;
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
    if (queryKey === 'settlement_rule_candidates') {
      const [assetType, transactionType, tradeDate] = params as [string, string, string, string];
      const day = String(tradeDate ?? '').slice(0, 10);
      const defaults: InMemoryRow[] = [
        {
          id: 'B3_OPTION_PREMIUM_D1',
          rule_code: 'B3_OPTION_PREMIUM_D1',
          contract_type_code: 'B3_OPTION_PREMIUM',
          asset_type: assetType,
          transaction_type: transactionType,
          valid_from: '1900-01-01',
          valid_to: null,
          days_offset: 1,
          calendar_unit: 'business_days',
          business_calendar_code: 'B3',
          default_status: 'pending',
          label: 'Opcao - premio D+1 util',
          priority: 10,
          ticker_prefix: null,
        },
        {
          id: 'B3_EQUITY_D3_LEGACY',
          rule_code: 'B3_EQUITY_D3_LEGACY',
          contract_type_code: 'B3_EQUITY_SPOT',
          asset_type: assetType,
          transaction_type: transactionType,
          valid_from: '1900-01-01',
          valid_to: '2019-05-26',
          days_offset: 3,
          calendar_unit: 'business_days',
          business_calendar_code: 'B3',
          default_status: 'pending',
          label: 'Acao/FII - D+3 util',
          priority: 10,
          ticker_prefix: null,
        },
        {
          id: 'B3_EQUITY_D2',
          rule_code: 'B3_EQUITY_D2',
          contract_type_code: 'B3_EQUITY_SPOT',
          asset_type: assetType,
          transaction_type: transactionType,
          valid_from: '2019-05-27',
          valid_to: null,
          days_offset: 2,
          calendar_unit: 'business_days',
          business_calendar_code: 'B3',
          default_status: 'pending',
          label: 'Acao/FII - D+2 util',
          priority: 10,
          ticker_prefix: null,
        },
      ];
      const equityTypes = new Set(['stock', 'fii', 'etf', 'bdr']);
      const optionTypes = new Set(['option_call', 'option_put']);
      const optionTx = new Set(['call_sell', 'put_sell', 'call_buy', 'put_buy']);
      return defaults.filter((row) => {
        const rule = String(row.rule_code);
        const from = String(row.valid_from);
        const to = row.valid_to ? String(row.valid_to) : null;
        if (day < from || (to && day > to)) return false;
        if (rule === 'B3_OPTION_PREMIUM_D1') {
          return optionTypes.has(String(assetType)) && optionTx.has(String(transactionType));
        }
        return equityTypes.has(String(assetType)) && ['buy', 'sell'].includes(String(transactionType));
      });
    }
    const [orgId, from, to, limit] = params as [string, string, string, number];
    const table =
      queryKey === 'business_event_orphan_patrimony_legs'
        ? 'patrimony_ledger_entries'
        : queryKey === 'business_event_orphan_financial_legs'
        ? 'financial_ledger_entries'
        : null;
    if (queryKey === 'market_quotes_latest_date') {
      const quotes = this.tables.get('market_quotes_daily');
      let latest = '';
      if (quotes) {
        for (const row of quotes.values()) {
          if (row.deleted_at) continue;
          const price = Number(row.closing_price ?? 0);
          const date = String(row.quote_date ?? '').slice(0, 10);
          if (Number.isFinite(price) && price > 0 && date > latest) latest = date;
        }
      }
      return latest ? [{ id: 'market_quotes_latest_date', quote_date: latest }] : [];
    }
    if (queryKey === 'invest_broker_aliases_all') {
      const t = this.tables.get('invest_broker_aliases');
      if (!t) return [];
      return Array.from(t.values()).filter((r) => !r.deleted_at).map((r) => ({ ...r }));
    }
    if (!table) throw new Error(`[inMemoryGateway] readQuery: ${queryKey} nao suportada`);
    const t = this.tables.get(table);
    if (!t) return [];
    const out: InMemoryRow[] = [];
    for (const row of t.values()) {
      if (row.deleted_at) continue;
      if (row.business_event_id && row.business_event_id !== '__legacy_missing_business_event__') {
        continue;
      }
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
