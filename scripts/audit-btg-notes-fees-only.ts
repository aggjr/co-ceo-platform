/**
 * Pente fino: taxas/emolumentos/corretagem somente nas notas de corretagem (PDF).
 * Não usa extrato financeiro (isso fica para a máquina note-guto).
 *
 * Uso:
 *   npx ts-node scripts/audit-btg-notes-fees-only.ts
 *   npx ts-node scripts/audit-btg-notes-fees-only.ts "G:\Meu Drive\01 - Nova Estrutura\Notas Corretagem"
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  aggregateNoteFees,
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  parseFeeLine,
  type BtgBrokerageNote,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';

const nodeRequire = createRequire(__filename);
const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs') as {
  getDocument: (opts: { data: Uint8Array; verbosity: number }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
      }>;
    }>;
  };
};

const defaultRoot =
  process.argv[2] ||
  path.join('G:', 'Meu Drive', '01 - Nova Estrutura', 'Notas Corretagem');
const notasRoot = fs.existsSync(path.join(defaultRoot, 'notas-corretagem'))
  ? path.join(defaultRoot, 'notas-corretagem')
  : defaultRoot;
const outDir = path.join(notasRoot, 'auditoria');

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
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (line.length) lines.push(line.join(' ').trim());
        line = [];
      }
      line.push(item.str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(' ').trim());
  }
  return lines;
}

function inferCategory(filePath: string): BtgNoteCategory {
  const u = filePath.replace(/\\/g, '/').toUpperCase();
  if (u.includes('/LOAN/') || u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('/OPTIONS/') || u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

function listPdfs(root: string): string[] {
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

function feeLinesInBlock(block: string[]): string[] {
  const res: string[] = [];
  let inResumo = false;
  for (const line of block) {
    if (/^resumo dos neg[oó]cios/i.test(line)) inResumo = true;
    if (/^resumo financeiro/i.test(line)) inResumo = true;
    if (!inResumo) continue;
    if (/^neg[oó]cios realizados/i.test(line)) continue;
    if (parseFeeLine(line)) continue;
    if (/taxa|emolument|corret|irrf|bovespa|cblc|registro|liquida|iss|clearing|execu/i.test(line)) {
      res.push(line);
    }
  }
  return res;
}

async function main() {
  console.log(`Notas: ${notasRoot}\n`);
  const pdfs = listPdfs(notasRoot);
  if (!pdfs.length) {
    console.error('Nenhum PDF *_ALL.pdf encontrado.');
    process.exit(1);
  }

  const all: BtgBrokerageNote[] = [];
  const unparsedSamples: string[] = [];

  for (const pdf of pdfs) {
    const lines = await pdfToLines(pdf);
    const cat = inferCategory(pdf);
    const notes = parseBtgBrokerageNoteBlocks(lines, pdf, cat);
    for (const n of notes) {
      if (n.category === 'LOAN') continue;
      const blocks = lines.join('\n').split('NOTA DE CORRETAGEM');
      for (const frag of blocks) {
        if (!frag.includes(n.noteNumber)) continue;
        const blockLines = frag.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const ul of feeLinesInBlock(blockLines)) {
          if (unparsedSamples.length < 40) unparsedSamples.push(`${n.noteNumber} ${n.pregaoDate}: ${ul}`);
        }
      }
    }
    all.push(...notes);
  }

  const { kept } = dedupeBrokerageNotes(all);
  const gaps: Array<Record<string, unknown>> = [];
  let totalGross = 0;
  let totalFeesAgg = 0;
  let totalImplied = 0;

  for (const note of kept) {
    if (note.category === 'LOAN' || !note.trades.length) continue;
    const gross = note.trades.reduce((s, t) => s + Math.abs(t.grossValue), 0);
    const agg = aggregateNoteFees(note);
    const feesSum = agg.totalDebit;
    const net = Math.abs(note.netSettlement ?? note.netOperations ?? 0);
    totalGross += gross;
    totalFeesAgg += feesSum;
    const implied = gross > 0 && net > 0 ? Math.abs(gross - net) : 0;
    totalImplied += implied;
    const delta = Math.abs(implied - feesSum);
    if (implied > 0.05 && delta > 0.05) {
      gaps.push({
        noteNumber: note.noteNumber,
        pregaoDate: note.pregaoDate,
        category: note.category,
        gross: Math.round(gross * 100) / 100,
        net: Math.round(net * 100) / 100,
        impliedFees: Math.round(implied * 100) / 100,
        parsedFees: Math.round(feesSum * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        feeBreakdown: agg,
        rawFees: note.fees,
      });
    }
  }

  gaps.sort((a, b) => Number(b.delta) - Number(a.delta));
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `notas-taxas-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        notasRoot,
        pdfs: pdfs.length,
        notes: kept.filter((n) => n.category !== 'LOAN').length,
        totalGross,
        totalFeesAggregated: totalFeesAgg,
        totalImpliedFromNet: totalImplied,
        gaps,
        unparsedFeeLineSamples: unparsedSamples,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`PDFs: ${pdfs.length}`);
  console.log(`Notas (sem LOAN): ${kept.filter((n) => n.category !== 'LOAN').length}`);
  console.log(`Soma taxas agregadas (novo): R$ ${totalFeesAgg.toFixed(2)}`);
  console.log(`Soma gap bruto×líquido: R$ ${totalImplied.toFixed(2)}`);
  console.log(`Notas com divergência > R$ 0,05: ${gaps.length}`);
  if (gaps.length) {
    console.log('\nTop 10 divergências:');
    for (const g of gaps.slice(0, 10)) {
      console.log(
        `  ${g.noteNumber} ${g.pregaoDate}: implied R$ ${g.impliedFees} | parsed R$ ${g.parsedFees} | Δ R$ ${g.delta}`
      );
    }
  }
  if (unparsedSamples.length) {
    console.log(`\nLinhas de taxa não parseadas (amostra ${unparsedSamples.length}):`);
    unparsedSamples.slice(0, 8).forEach((s) => console.log(`  ${s}`));
  }
  console.log(`\nJSON: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
