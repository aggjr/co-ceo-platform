import { randomUUID } from 'crypto';
import os from 'os';
import type { CoCeoDataGateway, SecurePayload, UserContext } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import type { OptionMarketSyncReport } from '../invest/OptionMarketSyncService';

export type PlatformJobStatus = 'running' | 'success' | 'warning' | 'error';
export type PlatformAlertSeverity = 'info' | 'warning' | 'error';

export type PlatformJobOutcome = {
  status: Exclude<PlatformJobStatus, 'running'>;
  title: string;
  body: string;
  summary?: Record<string, unknown>;
  errorMessage?: string | null;
};

function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function evaluateOptionsMarketSyncReport(
  report: OptionMarketSyncReport
): PlatformJobOutcome {
  if (report.errors.length > 0) {
    const detail = report.errors.map((e) => `${e.underlying}: ${e.message}`).join('; ');
    return {
      status: 'error',
      title: 'Sync opcoes.net com falhas',
      body: `${report.errors.length} acao(oes)-mae com erro. ${detail}`,
      summary: report as unknown as Record<string, unknown>,
      errorMessage: detail,
    };
  }
  const quoteMissing = report.quoteSync?.flatMap((q) => q.missing) ?? [];
  const fallbackHits = report.quoteSync?.flatMap((q) => q.fallbackResolved ?? []) ?? [];
  if (quoteMissing.length > 0) {
    const fallbackNote =
      fallbackHits.length > 0
        ? ` ${fallbackHits.length} via fontes alternativas (${fallbackHits.slice(0, 4).join(', ')}${fallbackHits.length > 4 ? '...' : ''}).`
        : '';
    return {
      status: 'warning',
      title: 'Sync opções com cotações faltantes',
      body:
        `${quoteMissing.length} opcao(oes) abertas sem cotação (opcoes.net + fallbacks): ` +
        `${quoteMissing.slice(0, 8).join(', ')}${quoteMissing.length > 8 ? '...' : ''}.${fallbackNote}`,
      summary: report as unknown as Record<string, unknown>,
    };
  }
  if (report.underlyings.length > 0 && report.rowsKept === 0) {
    return {
      status: 'warning',
      title: 'Sync opcoes.net sem linhas',
      body: `Nenhuma opcao do cliente encontrada na grade para: ${report.underlyings.join(', ')}.`,
      summary: report as unknown as Record<string, unknown>,
    };
  }
  return {
    status: 'success',
    title: 'Sync opcoes.net concluido',
    body:
      `${report.rowsKept} opcoes do cliente mantidas de ${report.rowsParsed} opcoes lidas em ` +
      `${report.underlyings.length} acao(oes)-mae (${report.inserted} novas, ${report.updated} atualizadas` +
      `${report.pruned ? `, ${report.pruned} antigas removidas` : ''}).` +
      `${report.quoteSync?.length ? ` Cotacoes salvas: ${report.quoteSync.reduce((sum, q) => sum + q.quotesSaved, 0)}.` : ''}`,
    summary: report as unknown as Record<string, unknown>,
  };
}

/**
 * Persiste execuções de jobs e gera alertas (warning/error) para a equipe co-CEO.
 * Escritas via SYSTEM_INSTALLER (tabelas system).
 */
export class PlatformJobMonitorService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  private installerCtx(): UserContext {
    return authBootstrapContext();
  }

  async startRun(jobKey: string): Promise<string> {
    const ctx = this.installerCtx();
    const id = randomUUID();
    const payload: SecurePayload = {
      id,
      job_key: jobKey,
      status: 'running',
      host: os.hostname().slice(0, 120),
    };
    await this.gateway.insert(ctx, 'platform_scheduled_job_runs', payload);
    return id;
  }

  async completeRun(runId: string, jobKey: string, outcome: PlatformJobOutcome): Promise<void> {
    const ctx = this.installerCtx();
    const payload: SecurePayload = {
      status: outcome.status,
      finished_at: nowSql(),
      summary_json: outcome.summary ? JSON.stringify(outcome.summary) : null,
      error_message: outcome.errorMessage ?? null,
    };
    await this.gateway.update(ctx, 'platform_scheduled_job_runs', runId, payload);

    if (outcome.status === 'warning' || outcome.status === 'error') {
      await this.createAlert({
        jobRunId: runId,
        jobKey,
        severity: outcome.status,
        title: outcome.title,
        body: outcome.body,
      });
    }
  }

  async failRun(runId: string, jobKey: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.completeRun(runId, jobKey, {
      status: 'error',
      title: `Job ${jobKey} falhou`,
      body: message,
      errorMessage: message,
    });
  }

  private async createAlert(input: {
    jobRunId: string;
    jobKey: string;
    severity: PlatformAlertSeverity;
    title: string;
    body: string;
  }): Promise<void> {
    const ctx = this.installerCtx();
    await this.gateway.insert(ctx, 'platform_admin_alerts', {
      id: randomUUID(),
      job_run_id: input.jobRunId,
      job_key: input.jobKey,
      severity: input.severity,
      title: input.title,
      body: input.body,
    });
  }

  async listUnreadAlerts(ctx: UserContext, limit = 20): Promise<Record<string, unknown>[]> {
    return this.gateway.readQuery(ctx, 'platform_admin_alerts_unread', [limit]);
  }

  async acknowledgeAlert(alertId: string, userId: string): Promise<void> {
    const ctx = this.installerCtx();
    await this.gateway.update(ctx, 'platform_admin_alerts', alertId, {
      acknowledged_at: nowSql(),
      acknowledged_by_user_id: userId,
    });
  }
}

/** Executa job com registro automático (qualquer cron futuro deve usar isto). */
export async function runMonitoredPlatformJob<T>(
  gateway: CoCeoDataGateway,
  jobKey: string,
  fn: () => Promise<T>,
  evaluate: (result: T) => PlatformJobOutcome
): Promise<T> {
  const monitor = new PlatformJobMonitorService(gateway);
  const runId = await monitor.startRun(jobKey);
  try {
    const result = await fn();
    await monitor.completeRun(runId, jobKey, evaluate(result));
    return result;
  } catch (err) {
    await monitor.failRun(runId, jobKey, err);
    throw err;
  }
}
