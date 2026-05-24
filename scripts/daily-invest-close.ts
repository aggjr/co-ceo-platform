/**
 * Fechamento INVEST manual (mesma rotina do cron 23h em produção).
 *
 * Uso:
 *   npm run invest:daily-close
 *   npm run invest:daily-close -- --date=2026-05-22
 *   npm run invest:daily-close -- org-holding-001
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import {
  brazilClosingDateIso,
  resolveInvestCronOrganizationIds,
  runInvestDailyCloseForOrg,
} from '../src/core/invest/investDailyCloseService';

dotenv.config();

function parseArgs(): { date: string; orgIds: string[] } {
  let date = brazilClosingDateIso();
  const orgIds = [...resolveInvestCronOrganizationIds()];
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--date=')) date = arg.slice(7).slice(0, 10);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) date = arg.slice(0, 10);
    else if (arg.startsWith('org-')) orgIds.push(arg);
  }
  return { date, orgIds: [...new Set(orgIds)] };
}

async function main() {
  const { date, orgIds } = parseArgs();
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);

  console.log('=== Fechamento INVEST', date, '===\n');

  for (const orgId of orgIds) {
    console.log('Organização:', orgId);
    const r = await runInvestDailyCloseForOrg(gateway, orgId, date);
    console.log('  Ações atualizadas:', r.stockQuotes.updated, '/', r.stockQuotes.requested);
    if (r.stockQuotes.missing.length) {
      console.log('  Faltando cotação:', r.stockQuotes.missing.join(', '));
    }
    if (r.options) {
      console.log('  Opções opcoes.net:', r.options.rowsParsed, 'linhas');
    }
    console.log('  Patrimônio (gravado):', r.patrimony.recorded.patrimony.toLocaleString('pt-BR'));
    console.log('  Econômico (auditoria):', r.patrimony.economicPatrimony.toLocaleString('pt-BR'));
    if (r.patrimony.btgPatrimony != null) {
      console.log('  BTG interpolado:   ', r.patrimony.btgPatrimony.toLocaleString('pt-BR'));
    }
    console.log(
      '  TWR dia:',
      r.patrimony.recorded.daily_return_twr != null
        ? `${(r.patrimony.recorded.daily_return_twr * 100).toFixed(4)}%`
        : '—'
    );
    console.log(
      '  TWR acum. gravado:',
      r.patrimony.recorded.cumulative_twr != null
        ? `${(r.patrimony.recorded.cumulative_twr * 100).toFixed(4)}%`
        : '—'
    );
    console.log('  Snapshots ativos:', r.patrimony.positionsSaved);
    console.log('');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
