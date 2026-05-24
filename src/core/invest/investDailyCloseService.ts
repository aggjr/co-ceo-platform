import type { CoCeoDataGateway } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { InvestQuoteSyncService } from './InvestQuoteSyncService';
import { OptionMarketSyncService } from './OptionMarketSyncService';
import type { OptionMarketSyncReport } from './OptionMarketSyncService';
import {
  PatrimonyDailyRecorder,
  type RecordDailyPatrimonyResult,
} from './PatrimonyDailyRecorder';
import type { QuoteSyncResult } from './InvestQuoteSyncService';

export type InvestDailyCloseResult = {
  closingDate: string;
  organizationId: string;
  stockQuotes: QuoteSyncResult;
  options: OptionMarketSyncReport | null;
  patrimony: RecordDailyPatrimonyResult;
};

/** Data de fechamento no fuso BRT (pregão do dia corrente quando o job roda à noite). */
export function brazilClosingDateIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.INVEST_CRON_TZ || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function resolveInvestCronOrganizationIds(): string[] {
  const raw = process.env.INVEST_CRON_ORG_IDS || process.env.PORTFOLIO_ORG_ID || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : ['org-holding-001'];
}

/**
 * Fechamento diário INVEST por organização:
 * cotações ações (brapi) → opções (opcoes.net) → grava invest_portfolio_daily + snapshots.
 * Ajustes de caixa semanais entram no livro (capital_deposit/withdrawal) antes do próximo fechamento.
 */
export async function runInvestDailyCloseForOrg(
  gateway: CoCeoDataGateway,
  organizationId: string,
  closingDate?: string
): Promise<InvestDailyCloseResult> {
  const date = (closingDate || brazilClosingDateIso()).slice(0, 10);
  const ctx = { ...authBootstrapContext(), organizationId, scope: 'node' as const };

  const quoteSync = new InvestQuoteSyncService(gateway);
  const optionSync = new OptionMarketSyncService(gateway);
  const recorder = new PatrimonyDailyRecorder(gateway);

  const stockQuotes = await quoteSync.syncFromBrapi(ctx, date);

  let options: OptionMarketSyncReport | null = null;
  try {
    options = await optionSync.syncFromOpcoesNet(ctx);
  } catch {
    options = null;
  }

  const patrimony = await recorder.recordDay(ctx, date);

  return {
    closingDate: date,
    organizationId,
    stockQuotes,
    options,
    patrimony,
  };
}

export function evaluateInvestDailyCloseResult(
  results: InvestDailyCloseResult[]
): {
  status: 'success' | 'warning' | 'error';
  title: string;
  body: string;
  summary: Record<string, unknown>;
} {
  if (!results.length) {
    return {
      status: 'error',
      title: 'Fechamento patrimônio sem organizações',
      body: 'Defina INVEST_CRON_ORG_IDS ou PORTFOLIO_ORG_ID.',
      summary: {},
    };
  }
  const missingQuotes = results.flatMap((r) => r.stockQuotes.missing);
  const patrimonies = results.map((r) => ({
    org: r.organizationId,
    date: r.closingDate,
    patrimony: r.patrimony.recorded.patrimony,
    dailyTwr: r.patrimony.recorded.daily_return_twr,
    cumulativeTwr: r.patrimony.recorded.cumulative_twr,
  }));
  const status = missingQuotes.length > 8 ? 'warning' : 'success';
  return {
    status,
    title: `Fechamento patrimônio ${results[0]!.closingDate}`,
    body:
      `${results.length} org(s). Patrimônio gravado em invest_portfolio_daily. ` +
      (missingQuotes.length
        ? `Cotações faltando: ${missingQuotes.slice(0, 6).join(', ')}${missingQuotes.length > 6 ? '…' : ''}.`
        : 'Cotações ações OK.'),
    summary: { patrimonies, missingQuotes },
  };
}
