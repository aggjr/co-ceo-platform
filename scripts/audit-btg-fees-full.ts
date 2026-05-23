/**
 * Auditoria completa: taxas nas notas de corretagem (PDF) + despesas no extrato
 * (custódia LFT/TD, IRRF, BTC, emolumentos em conta corrente).
 *
 * Fonte padrão: local-import/btg-sources/ (gitignored)
 *
 *   npx ts-node scripts/audit-btg-fees-full.ts
 *   npx ts-node scripts/audit-btg-fees-full.ts "outro/caminho/btg-sources"
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';

const nodeRequire = createRequire(__filename);
const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs') as {
  getDocument: (opts: { data: Uint8Array; verbosity: number }) => { promise: Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[] }> }> }>;
  }> };
};
import { btgLinesToImportEntries } from '../src/core/invest/BtgExtractLineParser';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';

const DEFAULT_BASE = path.join(process.cwd(), 'local-import', 'btg-sources');
const base = path.resolve(process.argv[2] || DEFAULT_BASE);
const extratoPdf = path.join(base, 'extrato', 'extrato.pdf');
const notasRoot = path.join(base, 'notas-corretagem');
const outDir = path.join(base, 'auditoria');

async function pdfToLines(filePath: string): Promise<string[]> {
  const buf = fs.readFileSync(filePath);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line: string[] = [];
    for (const item of content.items) {
      const y = Math.round((item as { transform: number[] }).transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (line.length) lines.push(line.join(' ').trim());
        line = [];
      }
      line.push((item as { str: string }).str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(' ').trim());
  }
  return lines;
}

function inferCategoryFromPath(filePath: string): BtgNoteCategory {
  const u = filePath.replace(/\\/g, '/').toUpperCase();
  if (u.includes('/LOAN/') || u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('/OPTIONS/')) return 'OPTIONS';
  return 'SPOT';
}

function listNotePdfs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.pdf$/i.test(name) && /_ALL\.pdf$/i.test(name) && !/_SUMMARY/i.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

type ExtractFeeRow = {
  date: string;
  amount: number;
  description: string;
  kind: string;
  ticker?: string;
  operation: string;
};

const FEE_DESC =
  /IRRF|TAXA|EMOLUMENT|CUST[ÓO]DIA|CORRETAGEM|IOF|JUROS\s+SOBRE\s+SALDO|BTC\s*PRIO3|TESOURO/i;

async function auditExtract(): Promise<{
  feeLines: ExtractFeeRow[];
  importFees: ExtractFeeRow[];
  lineCount: number;
}> {
  if (!fs.existsSync(extratoPdf)) {
    console.warn(`Extrato não encontrado: ${extratoPdf}`);
    return { feeLines: [], importFees: [], lineCount: 0 };
  }

  const rawLines = await pdfToLines(extratoPdf);
  const normalized = normalizeBtgExtractPdfText(rawLines.join('\n'));
  const normPath = path.join(path.dirname(extratoPdf), 'extrato-normalized.txt');
  fs.writeFileSync(normPath, normalized, 'utf8');

  const lines = normalized.split(/\r?\n/).filter(Boolean);
  const entries = btgLinesToImportEntries(lines);

  const importFees: ExtractFeeRow[] = entries
    .filter((e) => e.operation === 'cost_adjustment' || e.operation === 'fee')
    .map((e) => ({
      date: e.date,
      amount: Math.abs(Number(e.unit_price) || Number(e.total_net_value) || 0),
      description: e.notes || e.operation,
      kind: e.operation,
      ticker: e.ticker,
      operation: e.operation,
    }));

  const feeLines: ExtractFeeRow[] = [];
  for (const line of lines) {
    if (!FEE_DESC.test(line)) continue;
    const dm = line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/);
    if (!dm) continue;
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const desc = dm[4]!;
    if (/LIQ\s+BOLSA/i.test(desc) && !/TAXA|CUST[ÓO]DIA|IRRF|EMOLUMENT/i.test(desc)) {
      continue;
    }
    const amounts = [...desc.matchAll(/(-?[\d.]+,\d{2})/g)].map((m) =>
      Number(m[1]!.replace(/\./g, '').replace(',', '.'))
    );
    const mov = amounts.length >= 2 ? amounts[amounts.length - 1]! : amounts[0] ?? 0;
    if (Math.abs(mov) < 0.001 || Math.abs(mov) > 50_000) continue;
    let kind = 'outros';
    if (/CUST[ÓO]DIA|TAXA\s+DE\s+CUST/i.test(desc)) kind = 'custodia';
    else if (/TESOURO|LFT|TD/i.test(desc)) kind = 'tesouro_td';
    else if (/IRRF/i.test(desc)) kind = 'irrf';
    else if (/EMOLUMENT/i.test(desc)) kind = 'emolumentos';
    else if (/BTC|ALUGUEL/i.test(desc)) kind = 'btc';
    else if (/LIQ\s+BOLSA/i.test(desc)) kind = 'liq_bolsa';
    feeLines.push({
      date: iso,
      amount: Math.abs(mov),
      description: desc.slice(0, 120),
      kind,
      operation: 'extract_line',
    });
  }

  return { feeLines, importFees, lineCount: lines.length };
}

async function auditNotes(): Promise<{
  notes: BtgBrokerageNote[];
  stats: Record<string, number>;
  gapSamples: string[];
}> {
  const pdfs = listNotePdfs(notasRoot);
  const all: BtgBrokerageNote[] = [];
  for (const pdf of pdfs) {
    const lines = await pdfToLines(pdf);
    const cat = inferCategoryFromPath(pdf);
    all.push(...parseBtgBrokerageNoteBlocks(lines, pdf, cat));
  }
  const { kept } = dedupeBrokerageNotes(all);

  let withFees = 0;
  let gapSuspect = 0;
  const gapSamples: string[] = [];
  let totalFeesParsed = 0;
  let totalGross = 0;

  for (const note of kept) {
    if (note.category === 'LOAN') continue;
    const gross = note.trades.reduce((s, t) => s + Math.abs(t.grossValue), 0);
    totalGross += gross;
    const fees =
      Math.abs(note.settlementTax ?? 0) +
      Math.abs(note.registrationTax ?? 0) +
      Math.abs(note.emoluments ?? 0) +
      Math.abs(note.cblcTotal ?? 0) +
      Math.abs(note.bovespaTotal ?? 0) +
      Math.abs(note.irrf ?? 0);
    totalFeesParsed += fees;
    if (fees > 0) withFees += 1;
    const net = Math.abs(note.netOperations ?? 0);
    if (gross > 0 && net > 0) {
      const implied = Math.abs(gross - net);
      if (implied > 0.05 && fees < implied * 0.5) {
        gapSuspect += 1;
        if (gapSamples.length < 20) {
          gapSamples.push(
            `nota ${note.noteNumber} ${note.pregaoDate}: nominal R$ ${gross.toFixed(2)} | líquido R$ ${net.toFixed(2)} | taxas parseadas R$ ${fees.toFixed(2)} | gap R$ ${implied.toFixed(2)}`
          );
        }
      }
    }
  }

  const spotOpt = kept.filter((n) => n.category !== 'LOAN');
  return {
    notes: kept,
    stats: {
      pdfs: pdfs.length,
      notes: spotOpt.length,
      withFees,
      gapSuspect,
      totalFeesParsed,
      totalGross,
    },
    gapSamples,
  };
}

function sumBy<T>(items: T[], key: (x: T) => string, amount: (x: T) => number): Record<string, number> {
  const m: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    m[k] = (m[k] || 0) + amount(it);
  }
  return m;
}

async function main() {
  console.log(`Base: ${base}\n`);

  if (!fs.existsSync(base)) {
    console.error(
      'Pasta btg-sources não existe. Crie local-import/btg-sources/ e copie extrato + notas.\n' +
        'Veja local-import/README.txt'
    );
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const extract = await auditExtract();
  const notes = await auditNotes();

  const lftCustody = extract.importFees.filter(
    (f) => f.ticker?.startsWith('LFT') || /TESOURO|CUST/i.test(f.description)
  );
  const byKindExtract = sumBy(extract.feeLines, (r) => r.kind, (r) => r.amount);
  const byKindImport = sumBy(extract.importFees, (r) => r.kind, (r) => r.amount);

  const report = {
    generatedAt: new Date().toISOString(),
    base,
    extrato: {
      pdf: extratoPdf,
      lines: extract.lineCount,
      feeLinesMatched: extract.feeLines.length,
      importCostAdjustments: extract.importFees.length,
      totalImportFees: extract.importFees.reduce((s, f) => s + f.amount, 0),
      lftTdFees: lftCustody,
      byKindExtract,
      byKindImport,
    },
    notas: notes.stats,
    gapSamples: notes.gapSamples,
  };

  const reportPath = path.join(outDir, `auditoria-taxas-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== EXTRATO (caixa) ===');
  console.log(`Linhas normalizadas: ${extract.lineCount}`);
  console.log(`Linhas com palavra-chave de taxa: ${extract.feeLines.length}`);
  console.log(`Lançamentos cost_adjustment/fee (parser): ${extract.importFees.length}`);
  console.log(`Total taxas via parser extrato: R$ ${report.extrato.totalImportFees.toFixed(2)}`);
  console.log('Por tipo (linhas extrato):', byKindExtract);
  console.log(`Taxas LFT/Tesouro (cost_adjustment): ${lftCustody.length} eventos`);
  for (const f of lftCustody.slice(0, 10)) {
    console.log(`  ${f.date} R$ ${f.amount.toFixed(2)} — ${f.description.slice(0, 80)}`);
  }
  if (lftCustody.length > 10) console.log(`  ... +${lftCustody.length - 10}`);

  console.log('\n=== NOTAS DE CORRETAGEM ===');
  console.log(`PDFs *_ALL.pdf: ${notes.stats.pdfs}`);
  console.log(`Notas (sem LOAN): ${notes.stats.notes}`);
  console.log(`Com taxas parseadas: ${notes.stats.withFees}`);
  console.log(`Gap nominal×líquido (possível PDF incompleto): ${notes.stats.gapSuspect}`);
  console.log(`Soma taxas parseadas nas notas: R$ ${notes.stats.totalFeesParsed.toFixed(2)}`);
  if (notes.gapSamples.length) {
    console.log('\nAmostras de gap:');
    notes.gapSamples.forEach((s) => console.log(`  ${s}`));
  }

  console.log(`\nRelatório JSON: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
