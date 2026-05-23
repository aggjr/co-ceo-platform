import fs from 'fs';
import { createRequire } from 'module';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
} from '../src/core/invest/btgBrokerageNoteParser';

const nodeRequire = createRequire(__filename);
const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs');

async function pdfLines(pdf: string): Promise<string[]> {
  const buf = fs.readFileSync(pdf);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    let lastY: number | null = null;
    let line: string[] = [];
    for (const item of c.items as { str: string; transform: number[] }[]) {
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

async function main() {
  const pdf =
    'local-import/btg-sources/notas-corretagem/004176105_20260401_20260430/OPTIONS/004176105_20260401_20260430_OPTIONS_ALL.pdf';
  const notes = dedupeBrokerageNotes(
    parseBtgBrokerageNoteBlocks(await pdfLines(pdf), pdf, 'OPTIONS')
  ).kept;

  for (const n of ['31582497', '31609259']) {
    const note = notes.find((x) => x.noteNumber === n);
    if (!note) {
      console.log('nota', n, 'não encontrada');
      continue;
    }
    console.log(`\n=== NOTA ${n} (${note.pregaoDate}) — ${note.trades.length} negócios ===`);
    note.trades.forEach((t, i) => {
      console.log(
        `  ${i + 1}. ${t.side} ${t.ticker} qty=${t.quantity} px=${t.unitPrice} bruto=${t.grossValue}`
      );
    });
    const byTicker = new Map<string, number>();
    for (const t of note.trades) {
      const k = `${t.side}|${t.ticker}|${t.quantity}|${t.unitPrice}`;
      byTicker.set(k, (byTicker.get(k) || 0) + 1);
    }
    const dups = [...byTicker.entries()].filter(([, c]) => c > 1);
    if (dups.length) {
      console.log('  Negócios repetidos na nota (mesma fingerprint):');
      for (const [k, c] of dups) console.log(`    ×${c}  ${k}`);
    } else {
      console.log('  Nenhum negócio duplicado na nota (cada linha é única).');
    }
  }
}

main();
