/**
 * Backfill de invest_portfolio_daily (curva diária na tela Resultado Histórico).
 *
 * Uso:
 *   npx ts-node scripts/backfill-daily-patrimony.ts
 *   npx ts-node scripts/backfill-daily-patrimony.ts 2026-01-01
 *   npx ts-node scripts/backfill-daily-patrimony.ts --from=2026-01-01
 *   npx ts-node scripts/backfill-daily-patrimony.ts --from 2026-01-01
 */
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';
import { createInvestPool } from './lib/invest-db-pool';

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function parseStartDate(argv: string[]): string {
  const fromEq = argv.find((a) => a.startsWith('--from='));
  if (fromEq) return fromEq.slice('--from='.length);

  const fromIdx = argv.indexOf('--from');
  if (fromIdx >= 0 && argv[fromIdx + 1] && /^\d{4}-\d{2}-\d{2}$/.test(argv[fromIdx + 1]!)) {
    return argv[fromIdx + 1]!;
  }

  const positional = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (positional) return positional;

  return '2026-01-01';
}

function utcYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function formatUtcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export async function runBackfillPatrimonyDaily(
  pool: ReturnType<typeof createInvestPool>,
  startDate: string,
  orgId = ORG
): Promise<{ days: number; errors: number }> {
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: orgId, scope: 'node' as const };
  const recorder = new PatrimonyDailyRecorder(gateway);

  const start = utcYmd(startDate);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);

  console.log(
    `Backfill patrimônio diário: ${formatUtcYmd(start)} → ${formatUtcYmd(end)} (org ${orgId})`
  );

  let days = 0;
  let errors = 0;
  let current = start;
  while (current <= end) {
    const targetDate = formatUtcYmd(current);
    try {
      const result = await recorder.recordDay(ctx, targetDate, { initialLoad: true });
      days += 1;
      console.log(
        `[${targetDate}] ${result.recorded.patrimony.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })} (TWR acum: ${
          result.recorded.cumulative_twr != null
            ? `${(result.recorded.cumulative_twr * 100).toFixed(4)}%`
            : '—'
        })`
      );
    } catch (e: unknown) {
      errors += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[${targetDate}] Aviso: ${msg}`);
    }
    current = addUtcDays(current, 1);
  }

  console.log(`Backfill concluído: ${days} dia(s) processado(s), ${errors} aviso(s).`);
  return { days, errors };
}

async function main() {
  const startDate = parseStartDate(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(utcYmd(startDate).getTime())) {
    console.error(`Data inválida: ${startDate}. Use YYYY-MM-DD ou --from=YYYY-MM-DD.`);
    process.exit(1);
  }

  const pool = createInvestPool();
  try {
    await runBackfillPatrimonyDaily(pool, startDate);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Erro no backfill:', e);
    process.exit(1);
  });
}
