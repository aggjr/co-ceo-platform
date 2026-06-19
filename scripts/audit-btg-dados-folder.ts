/**
 * Auditoria offline — pasta "(dados)" do usuário (JSON + extratos + notas).
 * Usa o mesmo fluxo da tela Integração BTG (previewBtgBatchImport + LIQ assess).
 *
 *   npx ts-node scripts/audit-btg-dados-folder.ts
 *   $env:BTG_DADOS_DIR="G:\...\co_ceo_platform (dados)"
 */
import fs from 'fs';
import path from 'path';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';
import { MAIN_CASH_TICKER } from '../src/core/invest/ledgerTypes';
import type { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { UserContext } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';
import {
  assessLiqBolsaStrictForMonth,
  buildPendingPoolBySettlement,
  collectMonthImportLines,
  monthBounds,
  previewBtgBatchImport,
} from '../src/core/invest/btgMonthImportService';
import type { BtgUploadFileInput } from '../src/core/invest/btgUploadImportService';
import {
  parseExtractUploadImportLines,
  previewBtgBrokerageUpload,
} from '../src/core/invest/btgUploadImportService';
import {
  extractMovementBlock,
  parseExtractCashSeries,
} from '../src/core/invest/btgExtractCashSeries';
import { getExtractNormalizedLines } from '../src/core/invest/btgUploadImportService';

const DADOS_DIR =
  process.env.BTG_DADOS_DIR ||
  path.join(process.cwd(), 'Dados do Homebroker');

const EXTRACTS_DIR = path.join(DADOS_DIR, 'Extratos Financeiros');
const NOTES_ROOT = path.join(DADOS_DIR, 'Notas de Corretagem');
const PATRIMONIO_DIR = path.join(DADOS_DIR, 'Dados Patrimônio Mensal');

const OPENING_CASH = 58_758.79;

const EXTRACT_MONTH: Record<string, string> = {
  Jan_2026: '2026-01',
  Fev_2026: '2026-02',
  Mar_2026: '2026-03',
  Abr_2026: '2026-04',
  Mai_2026: '2026-05',
  Jun_2026: '2026-06',
};

function brl(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


type PendingAuditRow = {
  categoria: string;
  mes: string;
  data: string;
  valor: number | null;
  origem: string;
  status: string;
  motivo: string;
  acao_sugerida: string;
  detalhe: string;
};

const AUDIT_OUT_DIR = path.join(process.cwd(), 'local-import', 'btg-sources', 'auditoria');

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function writePendingCsv(rows: PendingAuditRow[]): string {
  fs.mkdirSync(AUDIT_OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(AUDIT_OUT_DIR, `pendencias-btg-dados-folder-${stamp}.csv`);
  const headers: Array<keyof PendingAuditRow> = [
    'categoria',
    'mes',
    'data',
    'valor',
    'origem',
    'status',
    'motivo',
    'acao_sugerida',
    'detalhe',
  ];
  const lines = [
    headers.join(';'),
    ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(';')),
  ];
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}
function toUpload(filePath: string, relBase: string): BtgUploadFileInput {
  const rel = path.relative(relBase, filePath).replace(/\\/g, '/');
  return {
    name: rel,
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

function listPdfsRecursive(dir: string, skipSummary = true): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPdfsRecursive(full, skipSummary));
    else if (/\.pdf$/i.test(ent.name) && (!skipSummary || !/summary\.pdf$/i.test(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function resolveNotesDirForMonth(month: string): string | null {
  if (!fs.existsSync(NOTES_ROOT)) return null;
  const ym = month.replace('-', '');
  for (const name of fs.readdirSync(NOTES_ROOT)) {
    if (!name.startsWith('004176105_')) continue;
    const full = path.join(NOTES_ROOT, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const m = name.match(/^004176105_(\d{8})_(\d{8})$/);
    if (!m) continue;
    const startYm = m[1]!.slice(0, 6);
    const endYm = m[2]!.slice(0, 6);
    if (startYm <= ym && endYm >= ym) return full;
  }
  return null;
}

function discoverPlan(): Array<{ month: string; extractPath: string; notesDir: string | null }> {
  const plan: Array<{ month: string; extractPath: string; notesDir: string | null }> = [];
  if (!fs.existsSync(EXTRACTS_DIR)) return plan;
  for (const name of fs.readdirSync(EXTRACTS_DIR).sort()) {
    if (!/\.pdf$/i.test(name)) continue;
    const base = name.replace(/\.pdf$/i, '');
    const month = EXTRACT_MONTH[base];
    if (!month) continue;
    plan.push({
      month,
      extractPath: path.join(EXTRACTS_DIR, name),
      notesDir: resolveNotesDirForMonth(month),
    });
  }
  return plan;
}

/** Livro só com abertura 01/01/2026 — mesma base da simulação "Limpar dados". */
function buildOpeningOnlyLedger(): LedgerEvent[] {
  return [
    {
      asset_id: 'audit-opening-cash',
      asset_ticker: MAIN_CASH_TICKER,
      asset_type: 'cash',
      transaction_type: 'opening_balance',
      transaction_date: '2026-01-01',
      quantity: 1,
      unit_price: OPENING_CASH,
      total_net_value: OPENING_CASH,
      broker_note_ref: 'OPENING:2026-01-01:CAIXA-BTG',
    } as LedgerEvent,
    {
      asset_id: 'audit-opening-prio3',
      asset_ticker: 'PRIO3',
      asset_type: 'stock',
      transaction_type: 'opening_balance',
      transaction_date: '2026-01-01',
      quantity: 5400,
      unit_price: 223_668.58 / 5400,
      total_net_value: 223_668.58,
      broker_note_ref: 'OPENING:2026-01-01:PRIO3',
    } as LedgerEvent,
    {
      asset_id: 'audit-opening-lft',
      asset_ticker: 'LFT-20310301',
      asset_type: 'fixed_income',
      transaction_type: 'opening_balance',
      transaction_date: '2026-01-01',
      quantity: 58,
      unit_price: 1_032_969.97 / 58,
      total_net_value: 1_032_969.97,
      broker_note_ref: 'OPENING:2026-01-01:LFT-20310301',
    } as LedgerEvent,
  ];
}

function makeOfflineLedger(events: LedgerEvent[]): LedgerImportService {
  return {
    listLedgerEvents: async () => events,
    getOpeningLedgerBalance: async () => OPENING_CASH,
    listPendingSignedCentsBySettlement: async () => ({}),
    enrichImportLinesForSettlement: async (_ctx: UserContext, lines: LedgerImportLine[]) => lines,
  } as unknown as LedgerImportService;
}

const auditCtx: UserContext = { ...installerContext(), organizationId: 'org-holding-001', scope: 'node' };

async function auditExtractLines(extractPath: string, month: string) {
  const file = toUpload(extractPath, EXTRACTS_DIR);
  const { normalizedLines, openingBalance } = await getExtractNormalizedLines(file);
  const block = extractMovementBlock(normalizedLines.join('\n'));
  const series = parseExtractCashSeries(block, openingBalance ?? OPENING_CASH);
  const dated = series.filter((p) => p.date);

  const liqLines = dated.filter((p) => /LIQ\s+BOLSA/i.test(p.description));
  const last = dated[dated.length - 1];

  const importLines = await parseExtractUploadImportLines(
    file,
    { includeLiqBolsa: true },
    openingBalance ?? OPENING_CASH,
    undefined,
    auditCtx,
    makeOfflineLedger(buildOpeningOnlyLedger())
  );
  const liqImport = importLines.filter((l) => /LIQ\s+BOLSA/i.test(String(l.notes || '')));

  console.log(`\n  Extrato: ${path.basename(extractPath)}`);
  console.log(`  Saldo ini: ${brl(openingBalance)}  |  Saldo fim: ${brl(last?.balance)} (${last?.date})`);
  console.log(`  Movimentos na série: ${dated.length}  |  LIQ BOLSA: ${liqLines.length} linha(s)`);

  if (liqLines.length) {
    console.log('\n  --- LIQ BOLSA (extrato, linha a linha) ---');
    console.table(
      liqLines.map((p) => ({
        data: p.date,
        valor: brl(p.movementAmount),
        saldo_apos: brl(p.balance),
        desc: p.description.slice(0, 60),
      }))
    );
  }

  return { liqImport, openingBalance, closing: last?.balance ?? null };
}

async function auditNotesPending(month: string, notesDir: string | null, allNoteUploads: BtgUploadFileInput[]) {
  const bounds = monthBounds(month);
  if (!bounds) return;

  const lines = await collectMonthImportLines(allNoteUploads);
  const pool = buildPendingPoolBySettlement(lines, bounds.from, bounds.to);

  const poolRows: Array<{ data: string; eventos: number; soma: string; centavos: string }> = [];
  for (const [date, cents] of Object.entries(pool).sort(([a], [b]) => a.localeCompare(b))) {
    const sum = cents.reduce((s, c) => s + c, 0);
    poolRows.push({
      data: date,
      eventos: cents.length,
      soma: brl(sum / 100),
      centavos: cents.join(', '),
    });
  }

  const notesInDir = notesDir ? listPdfsRecursive(notesDir) : [];
  console.log(`\n  Notas: pasta ${notesDir ? path.basename(notesDir) : '—'} (${notesInDir.length} PDF)`);
  for (const p of notesInDir) console.log(`    · ${path.relative(NOTES_ROOT, p)}`);

  if (poolRows.length) {
    console.log('\n  --- Pool pending (notas → liquidação no mês) ---');
    console.table(poolRows);
  } else {
    console.log('\n  --- Pool pending: VAZIO para este mês (notas não geraram expectativa?) ---');
  }

  return pool;
}

async function auditLiqMatch(
  month: string,
  extractPath: string,
  allNoteUploads: BtgUploadFileInput[]
) {
  const ledger = makeOfflineLedger(buildOpeningOnlyLedger());
  const extractFile = toUpload(extractPath, EXTRACTS_DIR);
  const liq = await assessLiqBolsaStrictForMonth(auditCtx, ledger, month, allNoteUploads, extractFile, {
    ignoreDbPending: true,
  });

  console.log(`\n  --- Casamento LIQ (assessLiqBolsaStrictForMonth) ---`);
  console.log(`  liqBolsaOk: ${liq.ok ? 'SIM' : 'NÃO'}  |  sem casamento: ${liq.unresolved.length}`);
  if (liq.unresolved.length) {
    console.table(
      liq.unresolved.map((u) => ({
        data: u.date,
        valor: brl(u.net),
        motivo: u.reason,
      }))
    );
  }
  return liq;
}

async function auditPatrimonioJson() {
  if (!fs.existsSync(PATRIMONIO_DIR)) return;
  console.log('\n========== PATRIMÔNIO MENSAL (JSON) ==========');
  const rows: Array<Record<string, string>> = [];
  for (const name of fs.readdirSync(PATRIMONIO_DIR).sort()) {
    if (!/^(JAN|FEV|MAR|ABR|MAI|JUN)_2026\.json$/i.test(name)) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(PATRIMONIO_DIR, name), 'utf8')) as {
      mes?: string;
      patrimonio_inicial?: number;
      patrimonio_final?: number;
      rendimentos?: number;
    };
    rows.push({
      arquivo: name,
      mês: raw.mes ?? '—',
      'patr. ini.': brl(raw.patrimonio_inicial),
      rendimentos: brl(raw.rendimentos),
      'patr. fim': brl(raw.patrimonio_final),
    });
  }
  if (rows.length) console.table(rows);

  const carteira = path.join(PATRIMONIO_DIR, 'carteira_atualizada_2026-06-17.json');
  if (fs.existsSync(carteira)) {
    const c = JSON.parse(fs.readFileSync(carteira, 'utf8')) as {
      data_referencia?: string;
      patrimonio?: { total?: number; conta_investimento?: { valor?: number } };
    };
    console.log(
      `\nCarteira ${c.data_referencia}: patrimônio total ${brl(c.patrimonio?.total)} | conta investimento ${brl(c.patrimonio?.conta_investimento?.valor)}`
    );
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  AUDITORIA BTG — pasta (dados) — mesmo fluxo da UI      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nDiretório: ${DADOS_DIR}`);
  console.log(`Existe: ${fs.existsSync(DADOS_DIR) ? 'SIM' : 'NÃO'}`);

  if (!fs.existsSync(DADOS_DIR)) {
    console.error('Pasta não encontrada. Defina BTG_DADOS_DIR.');
    process.exit(1);
  }

  await auditPatrimonioJson();

  const pendingRows: PendingAuditRow[] = [];

  const plan = discoverPlan();
  console.log('\n========== INVENTÁRIO ==========');
  console.table(
    plan.map((p) => ({
      mês: p.month,
      extrato: path.basename(p.extractPath),
      pasta_notas: p.notesDir ? path.basename(p.notesDir) : 'AUSENTE',
    }))
  );

  const allNotePaths = listPdfsRecursive(NOTES_ROOT);
  const allNoteUploads = allNotePaths.map((p) => toUpload(p, NOTES_ROOT));
  console.log(`\nTotal PDFs de notas (sem SUMMARY): ${allNotePaths.length}`);

  const notesPreview = await previewBtgBrokerageUpload(allNoteUploads);
  console.log(
    `Prévia notas (todos PDFs): ${notesPreview.filesOk}/${notesPreview.filesTotal} arquivos OK · ${notesPreview.notesKept} notas · ${notesPreview.ledgerLines} lanç.`
  );
  if (notesPreview.filesOk < notesPreview.filesTotal) {
    console.log('\nArquivos de nota com erro:');
    console.table(
      notesPreview.fileResults
        .filter((r) => !r.parseOk)
        .map((r) => ({ arquivo: r.fileName, erro: r.parseError }))
    );
  }

  for (const entry of plan) {
    console.log('\n' + '═'.repeat(60));
    console.log(`MÊS ${entry.month}`);
    console.log('═'.repeat(60));

    await auditExtractLines(entry.extractPath, entry.month);
    await auditNotesPending(entry.month, entry.notesDir, allNoteUploads);
    const liq = await auditLiqMatch(entry.month, entry.extractPath, allNoteUploads);
    for (const item of liq.unresolved) {
      pendingRows.push({
        categoria: 'LIQ_BOLSA_DESCONHECIDO',
        mes: entry.month,
        data: item.date,
        valor: item.net,
        origem: path.basename(entry.extractPath),
        status: 'pendente_analise',
        motivo: item.reason,
        acao_sugerida: 'Investigar com a corretora ou criar regra/tipo de evento para classificar este LIQ.',
        detalhe: liq.detail,
      });
    }
  }

  console.log('\n========== PRÉVIA BATCH (previewBtgBatchImport — simulação limpa) ==========');
  const extractUploads = plan.map((p) => toUpload(p.extractPath, EXTRACTS_DIR));
  const openingLedger = buildOpeningOnlyLedger();
  const ledger = makeOfflineLedger(openingLedger);

  const batch = await previewBtgBatchImport(auditCtx, ledger, allNoteUploads, extractUploads, {
    resetFirst: true,
  });

  console.log(batch.summary);
  console.log(
    `resultOk=${batch.resultOk} ready=${batch.monthsReady} blocked=${batch.monthsBlocked} chainOk=${batch.chainOk}`
  );
  console.table(
    batch.months.map((m) => ({
      mês: m.month,
      status: m.status,
      notas: m.notesOk ? 'OK' : '—',
      caixa: m.financialOk ? 'OK' : '—',
      liq: m.liqBolsaOk === true ? 'OK' : '—',
      pdfs_mês: m.notesFilesInMonth,
      'Δ ini': m.extract.openingLedgerDelta != null ? brl(m.extract.openingLedgerDelta) : '—',
      'Δ fim': m.extract.closingLedgerDelta != null ? brl(m.extract.closingLedgerDelta) : '—',
      detalhe: (m.resultDetail || '').slice(0, 80),
    }))
  );


  for (const m of batch.months) {
    if (!m.notesOk) {
      pendingRows.push({
        categoria: 'NOTA_NAO_PROCESSADA',
        mes: m.month,
        data: m.month,
        valor: null,
        origem: 'Notas de Corretagem',
        status: 'pendente_analise',
        motivo: m.notesDetail,
        acao_sugerida: 'Revisar PDFs da pasta do mes e parser de nota.',
        detalhe: m.resultDetail,
      });
    }
    if (!m.financialOk) {
      pendingRows.push({
        categoria: 'CAIXA_NAO_CONCILIADO',
        mes: m.month,
        data: m.month,
        valor: m.extract.closingLedgerDelta ?? m.extract.openingLedgerDelta ?? null,
        origem: m.extract.fileName,
        status: 'pendente_analise',
        motivo: m.financialDetail,
        acao_sugerida: 'Revisar cadeia de saldos, extrato e eventos desconhecidos importados.',
        detalhe: m.resultDetail,
      });
    }
    for (const note of m.noteSettlements ?? []) {
      if (note.status === 'closed') continue;
      pendingRows.push({
        categoria: `NOTA_${note.status.toUpperCase()}`,
        mes: m.month,
        data: note.pregaoDate,
        valor: note.deltaPoolCents / 100,
        origem: `Nota ${note.noteNumber}`,
        status: 'pendente_analise',
        motivo: note.detail,
        acao_sugerida: 'Revisar linhas da nota, taxas e materializacao financeira no extrato.',
        detalhe: `expected=${(note.expectedCents / 100).toFixed(2)} pool=${(note.poolCents / 100).toFixed(2)} materialized=${(note.materializedCents / 100).toFixed(2)}`,
      });
    }
  }

  const pendingCsv = writePendingCsv(pendingRows);
  console.log(`\nPlanilha CSV de pendencias: ${pendingCsv} (${pendingRows.length} item(ns))`);

  console.log('\n========== FIM — use esta saída para decidir correções ==========\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

