/**
 * Análise + reimportação jan–jun/2026 (notas → extrato), mês a mês.
 * Preserva abertura 01/01/2026; purge só do mês alvo.
 *
 *   npx ts-node scripts/reimport-btg-months-2026.ts --analyze
 *   npx ts-node scripts/reimport-btg-months-2026.ts --apply
 *   npx ts-node scripts/reimport-btg-months-2026.ts --apply --from 2026-02
 *   npx ts-node scripts/reimport-btg-months-2026.ts --apply --force   (pula check de reconciliação)
 *
 * Ao final exibe comparativo de rentabilidade mensal CO-CEO vs homebroker BTG.
 * Nota: a rentabilidade CO-CEO é calculada a partir de invest_portfolio_daily.
 * Se essa tabela não estiver populada, execute backfill-daily-patrimony.ts antes.
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
const FORCE = process.argv.includes('--force');
const FROM = process.argv.find((a) => a.startsWith('--from='))?.slice(7) || '2026-01';

/**
 * Rentabilidade mensal reportada pelo homebroker BTG (tela de Performance).
 * Fonte: capturas manuais — atualizar quando novos meses forem capturados.
 * Valores em percentual puro, ex.: 8.50 = +8,50%.
 */
const HOMEBROKER_MONTHLY_RETURNS: Record<string, number> = {
  '2026-01': 8.50,
  '2026-02': 1.76,
  '2026-03': 4.79,
  '2026-04': 7.29,
  '2026-05': -1.90,
  '2026-06': 0.05,
};

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

/** Rentabilidade mensal CO-CEO a partir de invest_portfolio_daily (Modified Dietz simplificado). */
async function monthlyReturnFromDailyTable(
  pool: mysql.Pool,
  month: string
): Promise<{ start: number; end: number; ret: number | null; hasData: boolean }> {
  const [y, m] = month.split('-').map(Number);
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  // Último snapshot do mês anterior (= abertura do mês)
  const prevMonth = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const [[startRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT patrimony FROM invest_portfolio_daily
     WHERE organization_id = ? AND snapshot_date BETWEEN ? AND ?
     ORDER BY snapshot_date DESC LIMIT 1`,
    [ORG, `${y - 1}-12-31`, new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)]
  );
  const [[endRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT patrimony FROM invest_portfolio_daily
     WHERE organization_id = ? AND snapshot_date BETWEEN ? AND ?
     ORDER BY snapshot_date DESC LIMIT 1`,
    [ORG, firstDay, lastDay]
  );

  // Fluxos externos (capital_deposit / capital_withdrawal) no mês
  const [[flowRow]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(SUM(
       CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'capital_deposit' THEN amount
            WHEN JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'capital_withdrawal' THEN -amount
            ELSE 0 END
     ), 0) AS flow
     FROM financial_ledger_entries
     WHERE organization_id = ?
       AND transaction_date >= ? AND transaction_date <= ?`,
    [ORG, firstDay, lastDay]
  );

  if (!startRow || !endRow) return { start: 0, end: 0, ret: null, hasData: false };

  const start = Number(startRow.patrimony);
  const end = Number(endRow.patrimony);
  const flow = Number(flowRow?.flow ?? 0);

  if (start <= 0) return { start, end, ret: null, hasData: true };

  // Modified Dietz: (Fim - Início - Fluxo) / (Início + 0.5 * Fluxo)
  const denom = start + 0.5 * flow;
  const ret = denom > 0 ? ((end - start - flow) / denom) * 100 : null;
  return { start, end, ret, hasData: true };
}

async function printReturnComparison(pool: mysql.Pool): Promise<void> {
  console.log('\n=== Comparativo de rentabilidade mensal ===');
  console.log('Fonte CO-CEO: invest_portfolio_daily (Modified Dietz)');
  console.log('Fonte HB: homebroker BTG (captura manual)\n');

  const rows = [];
  for (const spec of BTG_MONTHS_2026) {
    const hb = HOMEBROKER_MONTHLY_RETURNS[spec.month];
    const { start, end, ret, hasData } = await monthlyReturnFromDailyTable(pool, spec.month);
    const diff = ret != null && hb != null ? ret - hb : null;
    rows.push({
      mês: spec.label,
      'patrimônio início': brl(hasData ? start : undefined),
      'patrimônio fim': brl(hasData ? end : undefined),
      'CO-CEO %': ret != null ? `${ret.toFixed(2)}%` : '(sem dados)',
      'Homebroker %': hb != null ? `${hb.toFixed(2)}%` : '—',
      'Δ p.p.': diff != null ? `${diff.toFixed(2)}` : '—',
      'status': diff == null ? '?' : Math.abs(diff) < 0.5 ? 'OK' : Math.abs(diff) < 3 ? 'Atenção' : 'DIVERGENTE',
    });
  }
  console.table(rows);

  const divergentes = rows.filter((r) => r.status === 'DIVERGENTE');
  if (divergentes.length) {
    console.warn(`\nATENÇÃO: ${divergentes.length} mês(es) com divergência > 3 p.p. vs homebroker:`);
    for (const r of divergentes) {
      console.warn(`  ${r['mês']}: CO-CEO ${r['CO-CEO %']} | HB ${r['Homebroker %']} | Δ ${r['Δ p.p.']} p.p.`);
    }
    console.warn('\nPossíveis causas: operação patrimonial com sinal errado, abertura incorreta,');
    console.warn('ou invest_portfolio_daily não recalculado após reimport.');
    console.warn('Execute: npx ts-node scripts/backfill-daily-patrimony.ts --from 2026-01-01');
  } else {
    const hasData = rows.some((r) => r['CO-CEO %'] !== '(sem dados)');
    if (hasData) {
      console.log('Todos os meses com dados dentro de 3 p.p. do homebroker.');
    } else {
      console.log('invest_portfolio_daily sem dados — execute backfill-daily-patrimony.ts primeiro.');
    }
  }
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
    const msg = `${spec.label}: batimento falhou — ${before.financialDetail} (Δ fim ${before.extract.closingLedgerDelta?.toFixed(2)})`;
    if (FORCE) {
      console.warn(`AVISO (--force): ${msg}`);
    } else {
      throw new Error(msg);
    }
  }
  if (before.extract.monthAlreadyImported) {
    const msg = `${spec.label}: mês ainda marcado como importado após purge — verifique BTG-EXT`;
    if (FORCE) {
      console.warn(`AVISO (--force): ${msg}`);
    } else {
      throw new Error(msg);
    }
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
    const msg = `${spec.label}: Δ fim ${delta.toFixed(2)} acima da tolerância R$ ${MONTH_IMPORT_CASH_TOLERANCE}`;
    if (FORCE) {
      console.warn(`AVISO (--force): ${msg}`);
    } else {
      throw new Error(msg);
    }
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
      console.log('\n=== Análise jan–jun/2026 (livro remoto) ===\n');
      const rows = await analyzeAll(ctx, ledger);
      console.table(rows);
      const bad = rows.filter((r) => !r.ok);
      if (bad.length) {
        console.log(`${bad.length} mês(es) com atenção antes do apply.`);
        if (!APPLY) {
          await printReturnComparison(pool);
          process.exit(1);
        }
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
      console.log('\n=== Resumo de caixa por mês ===');
      console.table(
        results.map((r) => ({
          mês: r.spec.label,
          'saldo caixa livro': brl(r.cashEnd),
          'Δ vs extrato': brl(r.delta),
          ok: Math.abs(r.delta) <= MONTH_IMPORT_CASH_TOLERANCE ? 'OK' : 'ATENÇÃO',
        }))
      );
    }

    // Mostra comparativo de rentabilidade em qualquer modo
    await printReturnComparison(pool);

    if (APPLY) {
      console.log('\nPróximos passos:');
      console.log('  1. Se invest_portfolio_daily estava vazio, execute:');
      console.log('     npx ts-node scripts/backfill-daily-patrimony.ts --from 2026-01-01');
      console.log('  2. Rode novamente com --analyze para ver os dados finais.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
