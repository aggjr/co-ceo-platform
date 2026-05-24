import type { Pool } from 'mysql2/promise';
import { authBootstrapContext } from '../core/auth/authBootstrapContext';
import { CoCeoDataGateway } from '../core/dal';
import {
  evaluateOptionsMarketSyncReport,
  runMonitoredPlatformJob,
} from '../core/platform/PlatformJobMonitorService';
import { OptionMarketSyncService } from '../core/invest/OptionMarketSyncService';
import { scheduleDailyWallClock } from './cronSchedule';

let optionSyncRunning = false;

export async function runOptionMarketSyncJob(pool: Pool): Promise<void> {
  if (optionSyncRunning) {
    console.warn('[cron:options-market] execução anterior ainda em andamento — pulando.');
    return;
  }
  optionSyncRunning = true;
  try {
    const gateway = new CoCeoDataGateway(pool);
    const ctx = authBootstrapContext();
    const service = new OptionMarketSyncService(gateway);
    const report = await runMonitoredPlatformJob(
      gateway,
      'options-market',
      () => service.syncFromOpcoesNet(ctx),
      evaluateOptionsMarketSyncReport
    );
    console.log('[cron:options-market] relatório:', JSON.stringify(report));
  } finally {
    optionSyncRunning = false;
  }
}

function parseHourMinute(spec: string, fallbackHour: number, fallbackMinute: number) {
  const m = spec.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: fallbackHour, minute: fallbackMinute };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Cron embutido na API (EasyPanel / Docker) — não depende de ts-node nem crontab do host.
 * Produção: ativo por padrão. Dev: INVEST_CRON_ENABLED=1 para testar.
 */
export function startInvestMarketCron(pool: Pool): void {
  const enabled =
    process.env.INVEST_CRON_ENABLED === '1' ||
    (process.env.INVEST_CRON_ENABLED !== '0' && process.env.NODE_ENV === 'production');

  if (!enabled) {
    console.log('[cron] jobs INVEST desativados (defina INVEST_CRON_ENABLED=1 para ativar).');
    return;
  }

  const timeZone = process.env.INVEST_CRON_TZ || 'America/Sao_Paulo';
  const { hour, minute } = parseHourMinute(
    process.env.INVEST_CRON_OPTIONS_AT || '03:15',
    3,
    15
  );

  console.log(
    `[cron] invest ativo — opções.net diário às ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${timeZone})`
  );

  scheduleDailyWallClock(hour, minute, timeZone, 'options-market', () =>
    runOptionMarketSyncJob(pool)
  );

  if (process.env.INVEST_CRON_RUN_ON_STARTUP === '1') {
    const delayMs = Number(process.env.INVEST_CRON_STARTUP_DELAY_MS) || 120_000;
    console.log(
      `[cron] options-market no startup agendado em ${Math.round(delayMs / 1000)}s (API livre antes).`
    );
    setTimeout(() => {
      void runOptionMarketSyncJob(pool).catch((err) =>
        console.error('[cron:options-market] falha no startup:', err)
      );
    }, delayMs);
  }
}
