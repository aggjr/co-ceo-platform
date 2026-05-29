export type ReconcileAction =
  | 'insert_from_file'
  | 'void_ledger'
  | 'pair_rows'
  | 'keep_ledger_row'
  | 'confirm_skipped'
  | 'defer';

export type AuditSeverity = 'info' | 'warn' | 'error' | 'critical';

export type AuditIssue = {
  dimensionId: number;
  kind: string;
  severity: AuditSeverity;
  summaryKey: string;
  context: Record<string, unknown>;
  rowKeys?: string[];
};

export type ReconcileDecision = {
  decisionId: string;
  source: 'preview' | 'audit';
  kind: string;
  severity: AuditSeverity;
  summaryKey: string;
  context: Record<string, unknown>;
  rowKeys?: string[];
  allowedActions: ReconcileAction[];
  resolvedAt?: string;
  resolvedAction?: ReconcileAction;
};

export type AuditReport = {
  runAt: string;
  issues: AuditIssue[];
  pendingDecisions: ReconcileDecision[];
  countsBySeverity: Record<AuditSeverity, number>;
  canProceedToNextDay: boolean;
};

export type AuditRunOptions = {
  throughDate?: string;
  scope?: 'full' | 'through';
};

const BLOCKING: AuditSeverity[] = ['warn', 'error', 'critical'];

export function allowedActionsForKind(kind: string): ReconcileAction[] {
  switch (kind) {
    case 'file_only':
      return ['insert_from_file', 'defer'];
    case 'ledger_only':
      return ['void_ledger', 'pair_rows', 'defer'];
    case 'different':
    case 'cash_mismatch':
    case 'extract_cash_diff':
      return ['pair_rows', 'void_ledger', 'insert_from_file', 'defer'];
    case 'duplicate_external_ref':
      return ['keep_ledger_row', 'void_ledger', 'defer'];
    case 'orphan_patrimony_leg':
    case 'orphan_financial_leg':
    case 'header_without_legs':
    case 'legs_sum_mismatch':
      return ['void_ledger', 'defer'];
    case 'zero_fees':
      return ['insert_from_file', 'void_ledger', 'defer'];
    case 'cash_unlinked':
      return ['pair_rows', 'void_ledger', 'defer'];
    case 'qty_custody_mismatch':
      return ['defer'];
    case 'portfolio_daily_gap':
    case 'missing_quote':
      return ['defer'];
    case 'skipped_informative':
      return ['confirm_skipped', 'defer'];
    default:
      return ['defer'];
  }
}

export function issueToDecision(issue: AuditIssue): ReconcileDecision {
  return {
    decisionId: `audit:${issue.dimensionId}:${issue.kind}:${hashContext(issue.context)}`,
    source: 'audit',
    kind: issue.kind,
    severity: issue.severity,
    summaryKey: issue.summaryKey,
    context: issue.context,
    rowKeys: issue.rowKeys,
    allowedActions: allowedActionsForKind(issue.kind),
  };
}

export function buildAuditReport(issues: AuditIssue[]): AuditReport {
  const countsBySeverity: Record<AuditSeverity, number> = {
    info: 0,
    warn: 0,
    error: 0,
    critical: 0,
  };
  for (const i of issues) countsBySeverity[i.severity] += 1;

  const pendingDecisions = issues
    .filter((i) => BLOCKING.includes(i.severity))
    .map(issueToDecision);

  return {
    runAt: new Date().toISOString(),
    issues,
    pendingDecisions,
    countsBySeverity,
    canProceedToNextDay: pendingDecisions.length === 0,
  };
}

function hashContext(ctx: Record<string, unknown>): string {
  const raw = JSON.stringify(ctx);
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return String(Math.abs(h));
}
