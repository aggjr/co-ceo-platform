/**
 * Análise + reimportação jan–mai/2026 (notas → extrato), mês a mês.
 * Preserva abertura 01/01/2026; purge só do mês alvo.
 *
 *   npx ts-node scripts/reimport-btg-months-2026.ts --analyze
 *   npx ts-node scripts/reimport-btg-months-2026.ts --apply
 *   npx ts-node scripts/reimport-btg-months-2026.ts --apply --from 2026-02
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { MONTH_IMPORT_CASH_TOLERANCE } from '../src/core/invest/btgExtractBatchReconcile';
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

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const ANALYZE = process.argv.includes('--analyze') || !APPLY;
const FROM = process.argv.find((a) => a.startsWith('--from='))?.slice(7) || '2026-01';

function toUpload(filePath: string, relBase: string): BtgUploadFileInput {
  return {
    name: path.relative(relBase, filePath).replace(/\\/g, '/'),
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

function brl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type Row = Record<string, string | number | boolean>;

async function analyzeAll(
  ctx: ReturnType<typeof installerContext> & { organizationId: string },
  ledger: LedgerImportService
) {
  const base = btgSourcesBase();
  const rows: Row[] = [];
  let prevClosing: number | null = null;

  for (const spec of BTG_MONTHS_2026) {
    if (spec.month < FROM) continue;
    const extractPath = resolveExtractPath(base, spec);
    const notesDir = resolveNotesDir(base, spec);
    if (!fs.existsSync(extractPath) || !notesDir) {
      rows.push({
        mês: spec.label,
        ok: false,
        detalhe: !fs.existsSync(extractPath) ? 'extrato ausente' : 'pasta notas ausente',
      });
      continue;
    }

    const notePdfs = listNotePdfs(notesDir);
    const extractFile = toUpload(extractPath, base);
    const noteFiles = notePdfs.map((p) => toUpload(p, notesDir));
    const preview = await previewBtgMonthImport(ctx, ledger, spec.month, extractFile, noteFiles);

    const opening = preview.extract.openingExtract ?? null;
    const closing = preview.extract.closingExtract ?? null;
    const chainOk =
      prevClosing == null ||
      (opening != null &&
        Math.abs(opening - prevClosing) <= MONTH_IMPORT_CASH_TOLERANCE);

    const ok =
      preview.notesOk &&
      preview.extract.parseOk &&
      preview.extract.openingLedgerOk === true &&
      preview.extract.closingLedgerOk === true &&
      chainOk;

    rows.push({
      mês: spec.label,
      ok,
      notas: preview.notesOk,
      financeiro: preview.extract.closingLedgerOk === true,
      resultado: preview.resultOk,
      já_importado: preview.extract.monthAlreadyImported ? 'sim' : 'não',
      cadeia: chainOk ? 'OK' : 'Não',
      'ini extrato': brl(opening),
      'fim extrato': brl(closing),
      'livro fim': brl(preview.extract.closingLedgerBalance ?? null),
      'Δ fim': brl(preview.extract.closingLedgerDelta ?? null),
      detalhe: preview.resultDetail,
    });
    if (closing != null) prevClosing = closing;
  }
  return rows;
}

async function applyMonth(spec: (typeof BTG_MONTHS_2026)[0], ctx: Parameters<typeof analyzeAll>[0], ledger: LedgerImportService) {
  const base = btgSourcesBase();
  const extractPath = resolveExtractPath(base, spec);
  const notesDir = resolveNotesDir(base, spec)!;
  const notePdfs = listNotePdfs(notesDir);
  const extractFile = toUpload(extractPath, base);
  const noteFiles = notePdfs.map((p) => toUpload(p, notesDir));

  console.log(`\n========== ${spec.label} ==========`);
  execSync(`npx ts-node scripts/purge-invest-month.ts ${spec.month} --confirm`, {
    stdio: 'inherit',
    cwd: ROOT,
  });

  const before = await previewBtgMonthImport(ctx, ledger, spec.month, extractFile, noteFiles);
  if (!before.notesOk) {
    throw new Error(`${spec.label}: notas não OK — ${before.notesDetail}`);
  }
  if (!before.extract.parseOk) {
    throw new Error(`${spec.label}: extrato ilegível — ${before.extract.parseError}`);
  }
  const reconciled =
    before.extract.openingLedgerOk === true && before.extract.closingLedgerOk === true;
  if (!reconciled) {
    throw new Error(
      `${spec.label}: batimento falhou — ${before.financialDetail} (Δ fim ${before.extract.closingLedgerDelta?.toFixed(2)})`
    );
  }
  if (before.extract.monthAlreadyImported) {
    throw new Error(`${spec.label}: mês ainda marcado como importado após purge — verifique BTG-EXT`);
  }

  const applied = await applyBtgMonthImport(ctx, ledger, spec.month, extractFile, noteFiles);
  if (!applied.applied) {
    throw new Error(`${spec.label}: apply falhou — ${applied.resultDetail}`);
  }

  const closingDate = applied.extract.closingDate || `${spec.month}-28`;
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const cashEnd = settledCashBalanceFromLedger(events, closingDate);
  const delta = (applied.extract.closingExtract ?? 0) - cashEnd;

  console.log('Notas +', applied.notesInserted, 'Extrato +', applied.extractInserted);
  console.log('Saldo caixa livro:', brl(cashEnd), '| extrato:', brl(applied.extract.closingExtract), '| Δ:', brl(delta));

  if (Math.abs(delta) > MONTH_IMPORT_CASH_TOLERANCE) {
    throw new Error(`${spec.label}: Δ fim ${delta.toFixed(2)} acima da tolerância R$ ${MONTH_IMPORT_CASH_TOLERANCE}`);
  }
  return { spec, cashEnd, delta };
}

async function main() {
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    connectTimeout: 30000,
  });

  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(new CoCeoDataGateway(pool));

  try {
    if (ANALYZE) {
      console.log('\n=== Análise jan–mai/2026 (livro remoto) ===\n');
      const rows = await analyzeAll(ctx, ledger);
      console.table(rows);
      const bad = rows.filter((r) => !r.ok);
      if (bad.length) {
        console.log(`${bad.length} mês(es) com atenção antes do apply.`);
        if (!APPLY) process.exit(1);
      }
    }

    if (APPLY) {
      console.log('\n=== Reimportação (--apply) ===');
      const results = [];
      for (const spec of BTG_MONTHS_2026) {
        if (spec.month < FROM) {
          console.log(`Pulando ${spec.label} (--from ${FROM})`);
          continue;
        }
        results.push(await applyMonth(spec, ctx, ledger));
      }
      console.log('\n=== Resumo final ===');
      console.table(
        results.map((r) => ({
          mês: r.spec.label,
          'saldo livro': brl(r.cashEnd),
          Δ: brl(r.delta),
        }))
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
