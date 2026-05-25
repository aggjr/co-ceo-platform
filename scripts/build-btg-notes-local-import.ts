/**
 * Gera notas-review.json a partir de PDFs em local-import/btg-sources/notas-corretagem.
 * Uso: npx ts-node scripts/build-btg-notes-local-import.ts
 */
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  dedupeBrokerageNotes,
  flattenNotesForReview,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
} from '../src/core/invest/btgBrokerageNoteParser';

const NOTES_ROOT = path.join(process.cwd(), 'local-import/btg-sources/notas-corretagem');
const OUT_JSON = path.join(
  process.cwd(),
  'local-import/btg-sources/auditoria/notas-review-2026.json'
);

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

function listPdfs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
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

async function main() {
  if (!fs.existsSync(NOTES_ROOT)) {
    console.error('Pasta não encontrada:', NOTES_ROOT);
    process.exit(1);
  }
  const allNotes: BtgBrokerageNote[] = [];
  for (const pdf of listPdfs(NOTES_ROOT)) {
    const rel = path.relative(NOTES_ROOT, pdf).replace(/\\/g, '/');
    const lines = await pdfToLines(pdf);
    const parsed = parseBtgBrokerageNoteBlocks(lines, rel);
    console.log(rel, '→', parsed.length, 'notas');
    allNotes.push(...parsed);
  }

  const { kept, skipped } = dedupeBrokerageNotes(allNotes);
  const payload = {
    generatedAt: new Date().toISOString(),
    stats: {
      notesRaw: allNotes.length,
      notesKept: kept.length,
      notesDuplicateSkipped: skipped.length,
    },
    notes: kept,
    rows: flattenNotesForReview(kept),
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log('\nOK:', OUT_JSON, payload.stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
