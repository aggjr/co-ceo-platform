/**
 * Relatório completo — janeiro/2026 (extrato + notas × livro).
 *   npx ts-node scripts/analyze-btg-month-jan-2026.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { previewBtgMonthImport } from '../src/core/invest/btgMonthImportService';
import type { BtgUploadFileInput } from '../src/core/invest/btgUploadImportService';
import { settledCashBalanceFromLedger } from '../src/core/invest/cashInvestLedger';
import {
  extractMovementBlock,
  parseExtractCashSeries,
} from '../src/core/invest/btgExtractCashSeries';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';
import { btgLinesToImportEntries } from '../src/core/invest/BtgExtractLineParser';
import { classifyBtgDescription } from '../src/core/invest/BtgExtractLineParser';

dotenv.config();

const MONTH = '2026-01';
const BASE = process.env.BTG_SOURCES_DIR || path.join('G:', 'Meu Drive', '01 - Nova Estrutura');
const EXTRACT_PDF = path.join(BASE, 'Jan_2026.pdf');
const NOTES_DIR = path.join(BASE, 'Notas Corretagem', '004176105_20260101_20260131');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function brl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function listPdfs(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPdfs(full));
    else if (/\.pdf$/i.test(ent.name)) out.push(full);
  }
  return out;
}

function toUpload(filePath: string, relBase: string): BtgUploadFileInput {
  return {
    name: path.relative(relBase, filePath).replace(/\\/g, '/'),
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

async function analyzeExtractFile() {
  const buf = fs.readFileSync(EXTRACT_PDF);
  const raw = await pdfBufferToText(buf);
  const lines = raw.includes('Movimentação - Conta Corrente')
    ? raw.split(/\r?\n/).filter((l) => l.trim())
    : raw.split(/\r?\n/).filter((l) => l.trim());

  let opening = 58758.79;
  for (const line of lines) {
    if (/Saldo\s+Inicial/i.test(line)) {
      const m = line.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
      if (m) opening = Number(m[1].replace(/\./g, '').replace(',', '.'));
    }
  }

  const block = extractMovementBlock(raw);
  const series = parseExtractCashSeries(block, opening);
  const dated = series.filter((p) => p.date);
  const last = dated[dated.length - 1];

  const entries = btgLinesToImportEntries(
    lines.join('\n').includes('Movimentação') ? lines : block,
    opening
  );

  const byOp: Record<string, { count: number; total: number }> = {};
  for (const e of entries) {
    byOp[e.operation] = byOp[e.operation] || { count: 0, total: 0 };
    byOp[e.operation].count += 1;
    byOp[e.operation].total += e.total_net_value;
  }

  const liqBolsa = dated.filter((p) => /LIQ\s+BOLSA/i.test(p.description));
  const teds = dated.filter((p) => /TED/i.test(p.description));

  return {
    opening,
    closing: last?.balance ?? null,
    lastDate: last?.date ?? null,
    firstDate: dated[0]?.date ?? null,
    movementDays: dated.length,
    entryCount: entries.length,
    byOp,
    liqBolsaCount: liqBolsa.length,
    liqBolsaTotal: liqBolsa.reduce((s, p) => s + p.movementAmount, 0),
    teds,
    topMovements: [...dated]
      .sort((a, b) => Math.abs(b.movementAmount) - Math.abs(a.movementAmount))
      .slice(0, 12),
  };
}

async function main() {
  console.log('\n========== JANEIRO/2026 — RELATÓRIO COMPLETO ==========\n');

  console.log('--- Arquivos ---');
  console.log('Extrato:', EXTRACT_PDF, fs.existsSync(EXTRACT_PDF) ? 'OK' : 'AUSENTE');
  const pdfs = listPdfs(NOTES_DIR);
  console.log(`Notas: ${pdfs.length} PDF em ${NOTES_DIR}`);
  for (const p of pdfs) console.log('  ·', path.relative(NOTES_DIR, p));

  console.log('\n--- Extrato (PDF Jan_2026) ---');
  const ex = await analyzeExtractFile();
  console.log('Saldo inicial (extrato):', brl(ex.opening));
  console.log('Saldo final (extrato):  ', brl(ex.closing), 'em', ex.lastDate);
  console.log('Período movimentação:   ', ex.firstDate, '→', ex.lastDate);
  console.log('Dias com lançamento:    ', ex.movementDays);
  console.log('Lançamentos gerados:    ', ex.entryCount);
  console.log('Variação líquida (fim-ini):', brl((ex.closing ?? 0) - ex.opening));
  console.log('LIQ BOLSA no extrato:   ', ex.liqBolsaCount, 'linhas, movimento líquido', brl(ex.liqBolsaTotal));
  console.log('\nPor tipo de operação (parser → livro):');
  console.table(
    Object.entries(ex.byOp).map(([op, v]) => ({
      operação: op,
      qtd: v.count,
      total: brl(v.total),
    }))
  );
  console.log('\nMaiores movimentos no extrato (|valor|):');
  for (const p of ex.topMovements) {
    const c = classifyBtgDescription(p.description);
    console.log(
      `  ${p.date}  ${brl(p.movementAmount).padStart(14)}  saldo ${brl(p.balance)}  ${p.description.slice(0, 55)}${c.skip ? ' [skip]' : ''}`
    );
  }
  if (ex.teds.length) {
    console.log('\nTEDs no extrato:');
    for (const t of ex.teds) console.log(`  ${t.date}  ${brl(t.movementAmount)}  ${t.description}`);
  }

  const noteFiles = pdfs.map((p) => toUpload(p, NOTES_DIR));
  const extractFile = toUpload(EXTRACT_PDF, BASE);

  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;

  console.log('\n--- Batimento unificado (notas + extrato × livro) ---');
  if (!password) {
    console.log('Sem DB_PASSWORD — pulando livro.');
    return;
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    charset: 'utf8mb4',
    connectTimeout: 20000,
  });

  try {
    const gateway = new CoCeoDataGateway(pool);
    const ledger = new LedgerImportService(gateway);
    const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

    const preview = await previewBtgMonthImport(ctx, ledger, MONTH, extractFile, noteFiles);

    console.log('Financeiro OK:     ', preview.financialOk ? 'SIM' : 'NÃO');
    console.log('Notas corretagem OK: ', preview.notesOk ? 'SIM' : 'NÃO');
    console.log('Resultado OK:        ', preview.resultOk ? 'SIM' : 'NÃO');
    console.log('\nDetalhe financeiro:', preview.financialDetail);
    console.log('Detalhe notas:      ', preview.notesDetail);
    console.log('Detalhe resultado:  ', preview.resultDetail);
    console.log('\nExtrato × livro:');
    console.log('  Saldo ini. extrato:', brl(preview.extract.openingExtract));
    console.log('  Livro no dia anterior ao 1º mov.:', brl(preview.extract.openingLedgerBalance));
    console.log('  Δ ini.:', brl(preview.extract.openingLedgerDelta), preview.extract.openingLedgerOk ? 'OK' : 'NÃO');
    console.log('  Saldo fim extrato: ', brl(preview.extract.closingExtract), 'em', preview.extract.closingDate);
    console.log('  Livro na última data:', brl(preview.extract.closingLedgerBalance));
    console.log('  Δ fim.:', brl(preview.extract.closingLedgerDelta), preview.extract.closingLedgerOk ? 'OK' : 'NÃO');
    console.log('  Mês já importado (BTG-EXT):', preview.extract.monthAlreadyImported ? 'SIM' : 'não');

    console.log('\nNotas:');
    console.log('  PDFs no mês:', preview.notesFilesInMonth);
    console.log('  Notas reconhecidas:', preview.notes.notesKept);
    console.log('  Lançamentos gerados:', preview.notes.ledgerLines);
    console.log('\nPor arquivo de nota:');
    console.table(
      preview.notes.fileResults.map((r) => ({
        arquivo: r.fileName,
        leitura: r.parseOk ? 'OK' : 'Erro',
        notas: r.notesCount,
        lançamentos: r.ledgerLines,
        detalhe: r.parseError || '—',
      }))
    );

    const events = await ledger.listLedgerEvents(ctx, '2026-01-01', '2026-01-31');
    const cash = events.filter((e) => String(e.asset_ticker || '').toUpperCase().startsWith('CAIXA'));
    const trades = events.filter(
      (e) => !String(e.asset_ticker || '').toUpperCase().startsWith('CAIXA')
    );

    const extJan = cash.filter((e) => String(e.broker_note_ref || '').startsWith('BTG-EXT-'));
    const noteCash = cash.filter(
      (e) =>
        String(e.broker_note_ref || '').includes('BTG-NOTA') ||
        String(e.broker_note_ref || '').includes(':CASH')
    );

    console.log('\n--- Livro razão (jan/2026 já gravado) ---');
    console.log('Lançamentos total jan:', events.length);
    console.log('  Custódia/ativos:    ', trades.length);
    console.log('  Caixa:              ', cash.length);
    console.log('    BTG-EXT (extrato):', extJan.length);
    console.log('    Caixa de notas:   ', noteCash.length);
    console.log('Saldo caixa 31/01 (livro):', brl(settledCashBalanceFromLedger(events, '2026-01-31')));
    console.log('Saldo caixa fim extrato:  ', brl(preview.extract.closingExtract));

    const cashByDay = new Map<string, number>();
    for (const e of cash) {
      const d = String(e.transaction_date || '').slice(0, 10);
      cashByDay.set(d, (cashByDay.get(d) ?? 0) + Number(e.total_net_value ?? 0));
    }
    console.log('\nFluxo de caixa por dia no livro (top |valor|):');
    const sortedDays = [...cashByDay.entries()].sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1])
    );
    for (const [d, v] of sortedDays.slice(0, 10)) {
      console.log(`  ${d}  ${brl(v)}`);
    }
  } catch (e) {
    console.error('Erro ao conectar livro:', e instanceof Error ? e.message : e);
  } finally {
    await pool.end();
  }

  console.log('\n========== FIM ==========\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
