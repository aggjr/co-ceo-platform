/**
 * Rotina diária (rodar na manhã do dia seguinte ao pregão):
 *   1) Cotações ações/FIIs → brapi.dev (fechamento D-1)
 *   2) Opções → snapshot BTG opcional (--snapshot)
 *   3) Grava patrimônio econômico do dia
 *
 * Uso:
 *   node ./node_modules/ts-node/dist/bin.js scripts/daily-invest-close.ts
 *   node ./node_modules/ts-node/dist/bin.js scripts/daily-invest-close.ts --date=2026-05-19
 *   node ./node_modules/ts-node/dist/bin.js scripts/daily-invest-close.ts --snapshot=data/invest/snapshot-btg-quotes-current.json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { InvestQuoteSyncService } from '../src/core/invest/InvestQuoteSyncService';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function defaultClosingDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseArgs(): { date: string; snapshot?: string; skipFetch: boolean } {
  let date = defaultClosingDate();
  let snapshot: string | undefined;
  let skipFetch = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--date=')) date = arg.slice(7).slice(0, 10);
    else if (arg === '--skip-fetch') skipFetch = true;
    else if (arg.startsWith('--snapshot=')) snapshot = arg.slice(11);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) date = arg.slice(0, 10);
  }
  return { date, snapshot, skipFetch };
}

async function main() {
  const { date, snapshot, skipFetch } = parseArgs();

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const quoteSync = new InvestQuoteSyncService(gateway);
  const recorder = new PatrimonyDailyRecorder(gateway);

  console.log('=== Fechamento INVEST', date, '===\n');

  if (!skipFetch) {
    console.log('1) Cotações B3 (brapi)…');
    const q = await quoteSync.syncFromBrapi(ctx, date);
    console.log('   Atualizados:', q.updated, '/', q.requested);
    if (q.missing.length) console.log('   Faltando:', q.missing.join(', '));
  } else {
    console.log('1) Cotações: pulado (--skip-fetch)');
  }

  const snapPath =
    snapshot || path.join(__dirname, '..', 'data', 'invest', 'snapshot-btg-quotes-current.json');
  if (fs.existsSync(snapPath)) {
    console.log('\n2) Opções do snapshot BTG:', snapPath);
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as {
      renda_variavel?: { opcoes?: { items?: Array<{ ticker: string; last_price?: number }> } };
    };
    const items = snap.renda_variavel?.opcoes?.items || [];
    const n = await quoteSync.applySnapshotOptions(ctx, items, date);
    console.log('   Opções atualizadas:', n);
  } else {
    console.log('\n2) Snapshot BTG não encontrado — opções mantêm última cotação gravada.');
  }

  console.log('\n3) Gravando patrimônio diário…');
  const saved = await recorder.recordDay(ctx, date);
  console.log('   Patrimônio:', saved.recorded.patrimony.toLocaleString('pt-BR'));
  console.log('   TWR dia:', saved.recorded.daily_return_twr != null ? `${(saved.recorded.daily_return_twr * 100).toFixed(4)}%` : '—');
  console.log('   Posições:', saved.positionsSaved);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
