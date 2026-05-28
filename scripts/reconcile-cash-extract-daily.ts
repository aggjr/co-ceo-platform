/**
 * Batimento dia a dia: saldo extrato BTG vs livro (CAIXA-BTG).
 *
 *   npx ts-node scripts/reconcile-cash-extract-daily.ts "G:\...\Extrato-normalized.txt"
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  extractMovementBlock,
  parseExtractCashSeries,
} from '../src/core/invest/btgExtractCashSeries';
import { classifyBtgDescription } from '../src/core/invest/BtgExtractLineParser';
import { settledCashBalanceFromLedger } from '../src/core/invest/cashInvestLedger';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TODAY = new Date().toISOString().slice(0, 10);

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function endOfDayExtractBalances(
  series: ReturnType<typeof parseExtractCashSeries>
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const p of series) {
    if (!p.date) continue;
    byDate.set(p.date, p.balance);
  }
  return byDate;
}

function ledgerCashDeltaOnDate(events: LedgerEvent[], date: string): number {
  let sum = 0;
  for (const e of events) {
    if (!String(e.asset_ticker || '').toUpperCase().startsWith('CAIXA')) continue;
    if (String(e.transaction_date || '').slice(0, 10) !== date) continue;
    sum += Number(e.total_net_value ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

function classifyLine(description: string): { skip: boolean; liqBolsa: boolean } {
  const m = classifyBtgDescription(description);
  const u = description.toUpperCase();
  return {
    skip: Boolean(m.skip),
    liqBolsa: u.includes('LIQ BOLSA'),
  };
}

async function main() {
  const extractPath = path.resolve(
    process.argv[2] ||
      path.join('G:', 'Meu Drive', '01 - Nova Estrutura', 'Extrato-normalized.txt')
  );
  if (!fs.existsSync(extractPath)) {
    console.error('Arquivo não encontrado:', extractPath);
    process.exit(1);
  }

  const text = fs.readFileSync(extractPath, 'utf8');
  const block = extractMovementBlock(text);
  const series = parseExtractCashSeries(block);
  const extractByDay = endOfDayExtractBalances(series);

  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const events = await ledger.listLedgerEvents(ctx, '2026-01-01', TODAY);

  const dates = [...extractByDay.keys()].sort();
  const rows: Array<{
    date: string;
    extractBalance: number;
    ledgerBalance: number;
    diff: number;
    ledgerDayDelta: number;
    extractDayDelta: number;
    liqBolsaDay: number;
    importableDay: number;
  }> = [];

  let prevExtract: number | null = null;
  for (const date of dates) {
    const extractBalance = extractByDay.get(date)!;
    const ledgerBalance = settledCashBalanceFromLedger(events, date);
    const diff = Math.round((ledgerBalance - extractBalance) * 100) / 100;

    let liqBolsaDay = 0;
    let importableDay = 0;
    for (const p of series) {
      if (p.date !== date) continue;
      const { skip, liqBolsa } = classifyLine(p.description);
      if (liqBolsa) liqBolsaDay += p.movementAmount;
      else if (!skip) importableDay += p.movementAmount;
    }
    liqBolsaDay = Math.round(liqBolsaDay * 100) / 100;
    importableDay = Math.round(importableDay * 100) / 100;

    const extractDayDelta =
      prevExtract != null ? Math.round((extractBalance - prevExtract) * 100) / 100 : 0;
    const ledgerDayDelta = ledgerCashDeltaOnDate(events, date);

    rows.push({
      date,
      extractBalance,
      ledgerBalance,
      diff,
      ledgerDayDelta,
      extractDayDelta,
      liqBolsaDay,
      importableDay,
    });
    prevExtract = extractBalance;
  }

  const divergent = rows.filter((r) => Math.abs(r.diff) > 0.02);
  const last = rows[rows.length - 1];

  console.log('=== Batimento caixa dia a dia ===');
  console.log('Host:', host, '| Org:', ORG);
  console.log('Extrato:', extractPath);
  console.log('Dias com movimento:', rows.length);
  console.log('');

  if (last) {
    console.log('Último dia:', last.date);
    console.log('  Extrato:  ', brl(last.extractBalance));
    console.log('  Livro:    ', brl(last.ledgerBalance));
    console.log('  Diff:     ', brl(last.diff));
  }
  console.log('Dias com divergência > R$ 0,02:', divergent.length);

  console.log('\n--- Primeiras divergências (até 20) ---');
  for (const r of divergent.slice(0, 20)) {
    console.log(
      `${r.date}  extrato=${brl(r.extractBalance)}  livro=${brl(r.ledgerBalance)}  diff=${brl(r.diff)}  ` +
        `Δextrato=${brl(r.extractDayDelta)} Δlivro=${brl(r.ledgerDayDelta)} LIQ=${brl(r.liqBolsaDay)}`
    );
  }

  console.log('\n--- Últimas 10 datas ---');
  for (const r of rows.slice(-10)) {
    const flag = Math.abs(r.diff) > 0.02 ? ' !' : '';
    console.log(
      `${r.date}${flag}  ext=${brl(r.extractBalance)}  livro=${brl(r.ledgerBalance)}  diff=${brl(r.diff)}`
    );
  }

  const outDir = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `reconcile-cash-daily-${TODAY}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        organizationId: ORG,
        extractPath,
        lastDay: last,
        divergentDays: divergent.length,
        rows,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nRelatório: ${outPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
