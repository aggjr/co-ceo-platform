/**
 * Purge do mês + importação unificada (notas → extrato).
 *
 *   npx ts-node scripts/reimport-btg-month.ts 2026-01
 *   npx ts-node scripts/reimport-btg-month.ts 2026-01 --skip-purge
 *   BTG_SOURCES_DIR="G:\Meu Drive\01 - Nova Estrutura" npx ts-node scripts/reimport-btg-month.ts 2026-01
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  applyBtgMonthImport,
  previewBtgMonthImport,
} from '../src/core/invest/btgMonthImportService';
import type { BtgUploadFileInput } from '../src/core/invest/btgUploadImportService';
import { settledCashBalanceFromLedger } from '../src/core/invest/cashInvestLedger';
import {
  BTG_MONTHS_2026,
  btgSourcesBase,
  listNotePdfs,
  resolveExtractPath,
  resolveNotesDir,
} from './lib/btg-2026-months';

dotenv.config();

const MONTH = process.argv[2] || '';
const SKIP_PURGE = process.argv.includes('--skip-purge');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const BASE = btgSourcesBase();

function toUpload(filePath: string, relBase: string): BtgUploadFileInput {
  return {
    name: path.relative(relBase, filePath).replace(/\\/g, '/'),
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

function monthPaths(month: string) {
  const spec = BTG_MONTHS_2026.find((s) => s.month === month);
  if (!spec) return null;
  const notesDir = resolveNotesDir(BASE, spec);
  const extract = resolveExtractPath(BASE, spec);
  if (!notesDir) return null;
  return { extract, notesDir };
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) {
    console.error('Uso: ts-node scripts/reimport-btg-month.ts YYYY-MM [--skip-purge]');
    process.exit(1);
  }

  const paths = monthPaths(MONTH);
  if (!paths) {
    console.error('Mês não configurado ou pasta de notas ausente:', MONTH);
    process.exit(1);
  }
  const { extract, notesDir } = paths;
  if (!fs.existsSync(extract)) {
    console.error('Extrato não encontrado:', extract);
    process.exit(1);
  }

  const notePdfs = listNotePdfs(notesDir);
  console.log('Mês:', MONTH);
  console.log('Extrato:', extract);
  console.log('Notas:', notePdfs.length, 'PDF em', notesDir);

  if (!SKIP_PURGE) {
    execSync(`npx ts-node scripts/purge-invest-month.ts ${MONTH} --confirm`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  }

  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });

  try {
    const gateway = new CoCeoDataGateway(pool);
    const ledger = new LedgerImportService(gateway);
    const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

    const extractFile = toUpload(extract, BASE);
    const noteFiles = notePdfs.map((p) => toUpload(p, notesDir));

    console.log('\n--- Prévia ---');
    const before = await previewBtgMonthImport(ctx, ledger, MONTH, extractFile, noteFiles);
    console.log('Notas OK:', before.notesOk, '—', before.notesDetail);
    console.log('Financeiro OK:', before.financialOk, '—', before.financialDetail);
    console.log('Resultado OK:', before.resultOk, '—', before.resultDetail);

    if (!before.notesOk) {
      console.error('\nAbortado: corrija as notas antes de gravar.');
      process.exit(1);
    }

    const reconciled =
      before.extract.openingLedgerOk === true && before.extract.closingLedgerOk === true;
    if (!reconciled) {
      console.error('\nAbortado: batimento financeiro não OK na prévia.', before.financialDetail);
      process.exit(1);
    }

    console.log('\n--- Aplicando ---');
    const applied = await applyBtgMonthImport(ctx, ledger, MONTH, extractFile, noteFiles);
    console.log('applied:', applied.applied);
    console.log('notas +', applied.notesInserted, '/ skip', applied.notesSkipped);
    console.log('extrato +', applied.extractInserted, '/ skip', applied.extractSkipped);
    console.log('Notas OK:', applied.notesOk);
    console.log('Financeiro OK:', applied.financialOk);
    console.log('Resultado OK:', applied.resultOk);
    console.log(applied.resultDetail);

    const today = new Date().toISOString().slice(0, 10);
    const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
    const cashEnd = settledCashBalanceFromLedger(events, applied.extract.closingDate || `${MONTH}-28`);
    console.log('\nSaldo caixa livro:', cashEnd.toFixed(2));
    console.log('Saldo caixa extrato:', applied.extract.closingExtract?.toFixed(2) ?? '—');
    console.log('Δ fim:', applied.extract.closingLedgerDelta?.toFixed(2) ?? '—');

    if (!applied.applied) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
