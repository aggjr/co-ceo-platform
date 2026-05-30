import type { CoCeoDataGateway, UserContext } from '../../dal';
import { BusinessEventRegistry, BusinessEventReconciler } from '../../business-events';
import type { LedgerEvent } from '../CustodyEngine';
import { rebuildCustodyFromLedger } from '../CustodyEngine';
import { LedgerImportService } from '../LedgerImportService';
import { buildLedgerDedupIndex } from '../ledgerOperationDedup';
import { resolveInvestPeriodBounds } from '../investPeriodBounds';
import { PatrimonyDailyStore } from '../PatrimonyDailyStore';
import {
  type AuditIssue,
  type AuditReport,
  type AuditRunOptions,
  buildAuditReport,
} from './auditTypes';

const MONEY_TOL = 0.02;

export class ReconciliationAuditService {
  private readonly ledger: LedgerImportService;
  private readonly reconciler: BusinessEventReconciler;
  private readonly patrimonyStore: PatrimonyDailyStore;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
    const registry = new BusinessEventRegistry(gateway);
    this.reconciler = new BusinessEventReconciler(gateway, registry);
    this.patrimonyStore = new PatrimonyDailyStore(gateway);
  }

  async run(ctx: UserContext, opts: AuditRunOptions = {}): Promise<AuditReport> {
    if (!ctx.organizationId) throw new Error('organizationId obrigatório para varredura.');

    const today = new Date().toISOString().slice(0, 10);
    const through = (opts.throughDate ?? today).slice(0, 10);
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', through);
    const bounds = resolveInvestPeriodBounds(events);

    const issues: AuditIssue[] = [];
    issues.push(...(await this.checkOrphanLegs(ctx, bounds.periodMin, through)));
    issues.push(...(await this.checkBusinessEvents(ctx, bounds.periodMin, through)));
    issues.push(...this.checkLedgerDedup(events));
    issues.push(...this.checkOpeningIntegrity(events));
    issues.push(...this.checkTradeCoverage(events, through));
    issues.push(...this.checkCashNoteLinks(events));
    issues.push(...(await this.checkCustodyQty(ctx, events, opts)));
    issues.push(...(await this.checkPortfolioDailyGaps(ctx, bounds.periodMin, through, opts)));

    return buildAuditReport(issues);
  }

  private async checkOrphanLegs(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const orphans = await this.reconciler.findOrphanLegs(ctx, {
      transactionDateFrom: from,
      transactionDateTo: to,
      limit: 50,
    });
    for (const row of orphans.patrimony.slice(0, 20)) {
      issues.push({
        dimensionId: 1,
        kind: 'orphan_patrimony_leg',
        severity: 'error',
        summaryKey: 'invest.reconcile.audit.orphan_patrimony_leg',
        context: { legId: row.id, date: row.transaction_date },
        rowKeys: row.id ? [`pat:${row.id}`] : undefined,
      });
    }
    for (const row of orphans.financial.slice(0, 20)) {
      issues.push({
        dimensionId: 1,
        kind: 'orphan_financial_leg',
        severity: 'error',
        summaryKey: 'invest.reconcile.audit.orphan_financial_leg',
        context: { legId: row.id, date: row.transaction_date },
        rowKeys: row.id ? [`fin:${row.id}`] : undefined,
      });
    }
    return issues;
  }

  private async checkBusinessEvents(
    ctx: UserContext,
    from: string,
    to: string
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const rows = await this.gateway.findWhere(
      ctx,
      'business_events',
      {},
      { limit: 500 }
    );
    for (const row of rows) {
      const occurred = String(row.occurred_on ?? '').slice(0, 10);
      if (occurred < from || occurred > to) continue;
      if (row.voided_at) continue;
      const report = await this.reconciler.reconcileEvent(ctx, String(row.id));
      if (!report.consistent) {
        for (const msg of report.issues) {
          const kind = msg.includes('sem pernas')
            ? 'header_without_legs'
            : 'legs_sum_mismatch';
          issues.push({
            dimensionId: kind === 'header_without_legs' ? 1 : 2,
            kind,
            severity: 'error',
            summaryKey: `invest.reconcile.audit.${kind}`,
            context: { eventId: row.id, message: msg, delta: report.delta },
          });
        }
      }
    }
    return issues;
  }

  private checkLedgerDedup(events: LedgerEvent[]): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const index = buildLedgerDedupIndex(events);
    const refs = new Set<string>();
    for (const e of events) {
      const ref = String(e.broker_note_ref || '').trim();
      if (!ref) continue;
      if (refs.has(ref)) {
        issues.push({
          dimensionId: 4,
          kind: 'duplicate_external_ref',
          severity: 'warn',
          summaryKey: 'invest.reconcile.audit.duplicate_external_ref',
          context: { externalRef: ref },
        });
      }
      refs.add(ref);
    }
    void index;
    return issues;
  }

  private checkOpeningIntegrity(events: LedgerEvent[]): AuditIssue[] {
    const openings = events.filter((e) => e.transaction_type === 'opening_balance');
    if (!openings.length) {
      return [
        {
          dimensionId: 14,
          kind: 'opening_missing',
          severity: 'critical',
          summaryKey: 'invest.reconcile.audit.opening_missing',
          context: {},
        },
      ];
    }
    return [];
  }

  private checkTradeCoverage(events: LedgerEvent[], through: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const e of events) {
      const d = String(e.transaction_date).slice(0, 10);
      if (d > through) continue;
      if (e.asset_type === 'cash') continue;
      const ref = String(e.broker_note_ref || '');
      const isTrade =
        e.transaction_type === 'buy' ||
        e.transaction_type === 'sell' ||
        e.transaction_type === 'call_sell' ||
        e.transaction_type === 'put_sell';
      if (isTrade && !ref) {
        issues.push({
          dimensionId: 6,
          kind: 'ledger_only',
          severity: 'warn',
          summaryKey: 'invest.reconcile.audit.trade_without_note_ref',
          context: { ledgerId: e.id, ticker: e.asset_ticker, date: d },
          rowKeys: e.id ? [`pat:${e.id}`] : undefined,
        });
      }
      const fees =
        Math.abs(Number(e.brokerage_fee ?? 0)) +
        Math.abs(Number(e.b3_fees ?? 0)) +
        Math.abs(Number(e.irrf_tax ?? 0));
      if (isTrade && fees < MONEY_TOL && Math.abs(Number(e.total_net_value)) > 100) {
        issues.push({
          dimensionId: 7,
          kind: 'zero_fees',
          severity: 'warn',
          summaryKey: 'invest.reconcile.audit.zero_fees',
          context: { ledgerId: e.id, ticker: e.asset_ticker, date: d },
          rowKeys: e.id ? [`pat:${e.id}`] : undefined,
        });
      }
    }
    return issues;
  }

  private checkCashNoteLinks(events: LedgerEvent[]): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const e of events) {
      if (e.asset_type !== 'cash') continue;
      const type = String(e.transaction_type);
      if (type !== 'fee' && type !== 'dividend' && type !== 'interest') continue;
      if (!e.broker_note_ref) {
        issues.push({
          dimensionId: 9,
          kind: 'cash_unlinked',
          severity: 'warn',
          summaryKey: 'invest.reconcile.audit.cash_unlinked',
          context: { ledgerId: e.id, date: e.transaction_date, amount: e.total_net_value },
          rowKeys: e.id ? [`fin:${e.id}`] : undefined,
        });
      }
    }
    return issues;
  }

  private async checkCustodyQty(
    ctx: UserContext,
    events: LedgerEvent[],
    opts: AuditRunOptions = {}
  ): Promise<AuditIssue[]> {
    if (opts.scope === 'through' && !opts.horizonTrustedThrough) {
      return [];
    }
    const issues: AuditIssue[] = [];
    const projected = rebuildCustodyFromLedger(events);
    const assets = await this.gateway.findWhere(ctx, 'patrimony_items', {}, { limit: 500 });
    const qtyByTicker = new Map<string, number>();
    for (const row of projected.assets) {
      const t = String(row.ticker ?? '').toUpperCase();
      if (!t) continue;
      qtyByTicker.set(t, (qtyByTicker.get(t) ?? 0) + Number(row.quantity ?? 0));
    }
    for (const row of assets) {
      const t = String(row.identifier ?? row.asset_ticker ?? '').toUpperCase();
      if (!t) continue;
      const piQty = Number(row.quantity ?? 0);
      const ledgerQty = qtyByTicker.get(t) ?? 0;
      if (Math.abs(piQty) < 0.0001 && Math.abs(ledgerQty) < 0.0001) continue;
      if (Math.abs(piQty - ledgerQty) > 0.0001) {
        issues.push({
          dimensionId: 13,
          kind: 'qty_custody_mismatch',
          severity: 'error',
          summaryKey: 'invest.reconcile.audit.qty_custody_mismatch',
          context: { ticker: t, patrimonyItemsQty: piQty, ledgerQty },
        });
      }
    }
    return issues;
  }

  private async checkPortfolioDailyGaps(
    ctx: UserContext,
    from: string,
    through: string,
    opts: AuditRunOptions
  ): Promise<AuditIssue[]> {
    if (opts.scope !== 'through') return [];
    const horizon = opts.horizonTrustedThrough?.slice(0, 10);
    if (!horizon) return [];
    const stored = await this.patrimonyStore.loadRange(ctx, from, horizon);
    const dates = new Set(stored.map((s) => s.snapshot_date));
    const issues: AuditIssue[] = [];
    let d = from;
    while (d <= horizon) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6 && !dates.has(d)) {
        issues.push({
          dimensionId: 15,
          kind: 'portfolio_daily_gap',
          severity: 'warn',
          summaryKey: 'invest.reconcile.audit.portfolio_daily_gap',
          context: { date: d },
        });
      }
      const next = new Date(`${d}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
    return issues;
  }
}
