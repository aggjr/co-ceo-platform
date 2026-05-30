import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, SecurePayload, UserContext } from '../../dal';

export type ReconciliationPhase = 'notes' | 'cash';
export type ReconciliationSessionStatus =
  | 'in_progress'
  | 'notes_complete'
  | 'cash_complete'
  | 'aborted';

export type ReconciliationSessionRow = {
  id: string;
  organization_id: string;
  phase: ReconciliationPhase;
  status: ReconciliationSessionStatus;
  horizon_trusted_through: string | null;
  file_index: Record<string, unknown> | null;
  progress_by_day: Record<string, string> | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type DayLogAction = 'preview' | 'resolve' | 'close';

export type UserDecisionLog = {
  decisionId: string;
  action: string;
  at: string;
  userId?: string;
  rowKeys?: string[];
};

export type ReconciliationDayLogRow = {
  id: string;
  session_id: string;
  organization_id: string;
  business_date: string;
  action: DayLogAction;
  inserted: number;
  deleted: number;
  skipped: number;
  user_decisions: UserDecisionLog[] | null;
  audit_snapshot: Record<string, unknown> | null;
  created_at: string;
};

function parseJsonField<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function rowToSession(row: Record<string, unknown>): ReconciliationSessionRow {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    phase: row.phase as ReconciliationPhase,
    status: String(row.status) as ReconciliationSessionStatus,
    horizon_trusted_through: row.horizon_trusted_through
      ? String(row.horizon_trusted_through).slice(0, 10)
      : null,
    file_index: parseJsonField<Record<string, unknown>>(row.file_index),
    progress_by_day: parseJsonField<Record<string, string>>(row.progress_by_day),
    started_at: String(row.started_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at ? String(row.completed_at) : null,
  };
}

export class ReconciliationSessionStore {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async createSession(
    ctx: UserContext,
    input: {
      phase: ReconciliationPhase;
      fileIndex?: Record<string, unknown>;
    }
  ): Promise<ReconciliationSessionRow> {
    if (!ctx.organizationId) throw new Error('organizationId obrigatório.');
    const id = randomUUID();
    await this.gateway.insert(ctx, 'invest_reconciliation_sessions', {
      id,
      phase: input.phase,
      status: 'in_progress',
      horizon_trusted_through: null,
      file_index: input.fileIndex ? JSON.stringify(input.fileIndex) : null,
      progress_by_day: JSON.stringify({}),
      completed_at: null,
    });
    const rows = await this.gateway.findWhere(ctx, 'invest_reconciliation_sessions', { id }, {
      limit: 1,
    });
    return rowToSession(rows[0] as Record<string, unknown>);
  }

  async getById(ctx: UserContext, sessionId: string): Promise<ReconciliationSessionRow | null> {
    const rows = await this.gateway.findWhere(
      ctx,
      'invest_reconciliation_sessions',
      { id: sessionId },
      { limit: 1 }
    );
    return rows[0] ? rowToSession(rows[0] as Record<string, unknown>) : null;
  }

  async updateSession(
    ctx: UserContext,
    sessionId: string,
    patch: Partial<{
      status: ReconciliationSessionStatus;
      horizon_trusted_through: string | null;
      progress_by_day: Record<string, string>;
      file_index: Record<string, unknown>;
      completed_at: string | null;
    }>
  ): Promise<ReconciliationSessionRow> {
    const payload: SecurePayload = {};
    if (patch.status != null) payload.status = patch.status;
    if (patch.horizon_trusted_through !== undefined) {
      payload.horizon_trusted_through = patch.horizon_trusted_through;
    }
    if (patch.progress_by_day != null) {
      payload.progress_by_day = JSON.stringify(patch.progress_by_day);
    }
    if (patch.file_index != null) payload.file_index = JSON.stringify(patch.file_index);
    if (patch.completed_at !== undefined) payload.completed_at = patch.completed_at;

    await this.gateway.update(ctx, 'invest_reconciliation_sessions', sessionId, payload);
    const row = await this.getById(ctx, sessionId);
    if (!row) throw new Error(`Sessão ${sessionId} não encontrada.`);
    return row;
  }

  async appendDayLog(
    ctx: UserContext,
    input: {
      sessionId: string;
      businessDate: string;
      action: DayLogAction;
      inserted?: number;
      deleted?: number;
      skipped?: number;
      userDecisions?: UserDecisionLog[];
      auditSnapshot?: Record<string, unknown>;
    }
  ): Promise<ReconciliationDayLogRow> {
    if (!ctx.organizationId) throw new Error('organizationId obrigatório.');
    const id = randomUUID();
    await this.gateway.insert(ctx, 'invest_reconciliation_day_log', {
      id,
      session_id: input.sessionId,
      business_date: input.businessDate.slice(0, 10),
      action: input.action,
      inserted: input.inserted ?? 0,
      deleted: input.deleted ?? 0,
      skipped: input.skipped ?? 0,
      user_decisions: input.userDecisions ? JSON.stringify(input.userDecisions) : null,
      audit_snapshot: input.auditSnapshot ? JSON.stringify(input.auditSnapshot) : null,
    });
    return {
      id,
      session_id: input.sessionId,
      organization_id: ctx.organizationId,
      business_date: input.businessDate.slice(0, 10),
      action: input.action,
      inserted: input.inserted ?? 0,
      deleted: input.deleted ?? 0,
      skipped: input.skipped ?? 0,
      user_decisions: input.userDecisions ?? null,
      audit_snapshot: input.auditSnapshot ?? null,
      created_at: new Date().toISOString(),
    };
  }
}
