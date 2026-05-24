import mysql from 'mysql2/promise';
import { authBootstrapContext } from '../core/auth/authBootstrapContext';
import { CoCeoDataGateway } from '../core/dal';
import {
  evaluateOptionsMarketSyncReport,
  runMonitoredPlatformJob,
  type PlatformJobOutcome,
} from '../core/platform/PlatformJobMonitorService';
import { OptionMarketSyncService } from '../core/invest/OptionMarketSyncService';
import { StockMarketSyncService } from '../core/market/StockMarketSyncService';
import { scheduleDailyWallClock } from './cronSchedule';
import {
  evaluateInvestDailyCloseResult,
  resolveInvestCronOrganizationIds,
  runInvestDailyCloseForOrg,
} from '../core/invest/investDailyCloseService';

let optionSyncRunning = false;
let stockSyncRunning = false;
let patrimonyCloseRunning = false;
let cronPool: mysql.Pool | null = null;

/** Pool separado — sync noturno não esgota conexões da API (evita 502). */
function getCronPool(): mysql.Pool {
  if (!cronPool) {
    cronPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'co_ceo_platform',
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: process.env.DB_CRON_POOL_LIMIT
        ? parseInt(process.env.DB_CRON_POOL_LIMIT, 10)
        : 3,
      queueLimit: 0,
    });
  }
  return cronPool;
}

export async function runStockMarketSyncJob(pool = getCronPool()): Promise<void> {
  if (stockSyncRunning) {
    console.warn('[cron:stocks-market] execução anterior ainda em andamento — pulando.');
    return;
  }
  stockSyncRunning = true;
  try {
    const gateway = new CoCeoDataGateway(pool);
    const ctx = authBootstrapContext();
    const service = new StockMarketSyncService(gateway);
    const report = await service.syncFromBrapi(ctx);
    console.log('[cron:stocks-market] relatório:', JSON.stringify(report));
  } finally {
    stockSyncRunning = false;
  }
}

export async function runPatrimonyDailyCloseJob(pool = getCronPool()): Promise<void> {
  if (patrimonyCloseRunning) {
    console.warn('[cron:patrimony-daily] execução anterior ainda em andamento — pulando.');
    return;
  }
  patrimonyCloseRunning = true;
  try {
    const gateway = new CoCeoDataGateway(pool);
    const orgIds = resolveInvestCronOrganizationIds();
    await runMonitoredPlatformJob(
      gateway,
      'patrimony-daily',
      async () => {
        const results = [];
        for (const orgId of orgIds) {
          results.push(await runInvestDailyCloseForOrg(gateway, orgId));
        }
        return results;
      },
      (results): PlatformJobOutcome => {
        const ev = evaluateInvestDailyCloseResult(results);
        return {
          status: ev.status,
          title: ev.title,
          body: ev.body,
          summary: ev.summary,
        };
      }
    );
    console.log('[cron:patrimony-daily] concluído para', orgIds.join(', '));
  } finally {
    patrimonyCloseRunning = false;
  }
}

export async function runOptionMarketSyncJob(pool = getCronPool()): Promise<void> {
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
export function startInvestMarketCron(): void {
  const enabled =
    process.env.INVEST_CRON_ENABLED === '1' ||
    (process.env.INVEST_CRON_ENABLED !== '0' && process.env.NODE_ENV === 'production');

  if (!enabled) {
    console.log('[cron] jobs INVEST desativados (defina INVEST_CRON_ENABLED=1 para ativar).');
    return;
  }

  const timeZone = process.env.INVEST_CRON_TZ || 'America/Sao_Paulo';
  const optionsAt = parseHourMinute(process.env.INVEST_CRON_OPTIONS_AT || '03:15', 3, 15);
  const stocksAt = parseHourMinute(process.env.INVEST_CRON_STOCKS_AT || '19:05', 19, 5);
  const patrimonyAt = parseHourMinute(process.env.INVEST_CRON_PATRIMONY_AT || '23:00', 23, 0);

  console.log(
    `[cron] invest ativo — opções.net ${String(optionsAt.hour).padStart(2, '0')}:${String(optionsAt.minute).padStart(2, '0')}, ações brapi ${String(stocksAt.hour).padStart(2, '0')}:${String(stocksAt.minute).padStart(2, '0')}, fechamento patrimônio ${String(patrimonyAt.hour).padStart(2, '0')}:${String(patrimonyAt.minute).padStart(2, '0')} (${timeZone})`
  );

  scheduleDailyWallClock(optionsAt.hour, optionsAt.minute, timeZone, 'options-market', () =>
    runOptionMarketSyncJob()
  );

  scheduleDailyWallClock(stocksAt.hour, stocksAt.minute, timeZone, 'stocks-market', () =>
    runStockMarketSyncJob()
  );

  scheduleDailyWallClock(patrimonyAt.hour, patrimonyAt.minute, timeZone, 'patrimony-daily', () =>
    runPatrimonyDailyCloseJob()
  );

  if (process.env.INVEST_CRON_RUN_ON_STARTUP === '1') {
    const delayMs = Number(process.env.INVEST_CRON_STARTUP_DELAY_MS) || 120_000;
    console.log(
      `[cron] options-market no startup agendado em ${Math.round(delayMs / 1000)}s (API livre antes).`
    );
    setTimeout(() => {
      void runOptionMarketSyncJob().catch((err) =>
        console.error('[cron:options-market] falha no startup:', err)
      );
    }, delayMs);
  }
}
