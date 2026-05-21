/**
 * Ingere ZIPs de notas BTG (PDF), deduplica fim de abril e gera JSON de conferência.
 * Não grava no livro razão.
 *
 * Uso:
 *   npx ts-node scripts/build-btg-brokerage-notes-review.ts "g:\...\004176105_20260101_20260131.zip" ...
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  dedupeBrokerageNotes,
  flattenNotesForReview,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
} from '../src/core/invest/btgBrokerageNoteParser';

const DEFAULT_ZIPS = [
  'g:\\Meu Drive\\01 - Nova Estrutura\\004176105_20260101_20260131.zip',
  'g:\\Meu Drive\\01 - Nova Estrutura\\004176105_20260201_20260228.zip',
  'g:\\Meu Drive\\01 - Nova Estrutura\\004176105_20260301_20260331.zip',
  'g:\\Meu Drive\\01 - Nova Estrutura\\004176105_20260401_20260430.zip',
  'g:\\Meu Drive\\01 - Nova Estrutura\\004176105_20260421_20260520.zip',
];

const OUT_JSON = path.join(__dirname, '..', 'data', 'invest', 'btg-brokerage-notes-review-2026.json');
const OUT_PUBLIC = path.join(
  __dirname,
  '..',
  'frontend',
  'public',
  'data',
  'invest',
  'btg-brokerage-notes-review-2026.json'
);
const CACHE_DIR = path.join(__dirname, '..', 'data', 'invest', 'cache', 'btg-notes-zip');

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

function expandZip(zipPath: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  const cmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  execSync(cmd, { shell: 'powershell.exe', stdio: 'pipe' });
}

function listReviewPdfs(root: string): string[] {
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
  const zips = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ZIPS;
  const allNotes: BtgBrokerageNote[] = [];

  for (const zip of zips) {
    if (!fs.existsSync(zip)) {
      console.warn('ZIP ausente:', zip);
      continue;
    }
    const folder = path.join(CACHE_DIR, path.basename(zip, '.zip'));
    console.log('Expandindo', path.basename(zip));
    expandZip(zip, folder);
    for (const pdf of listReviewPdfs(folder)) {
      const lines = await pdfToLines(pdf);
      const rel = path.relative(folder, pdf).replace(/\\/g, '/');
      const parsed = parseBtgBrokerageNoteBlocks(lines, rel);
      console.log('  ', rel, '→', parsed.length, 'notas');
      allNotes.push(...parsed);
    }
  }

  const { kept, skipped } = dedupeBrokerageNotes(allNotes);
  const rows = flattenNotesForReview(kept);
  const payload = {
    generatedAt: new Date().toISOString(),
    ledgerImport: false,
    purpose: 'Conferência de notas de corretagem antes do livro caixa',
    stats: {
      notesRaw: allNotes.length,
      notesKept: kept.length,
      notesDuplicateSkipped: skipped.length,
      tradeLines: rows.filter((r) => Number(r.lineNo) > 0).length,
    },
    duplicatesSkipped: skipped.map((n) => ({
      dedupeKey: n.dedupeKey,
      noteNumber: n.noteNumber,
      pregaoDate: n.pregaoDate,
      category: n.category,
      sourceFile: n.sourceFile,
      duplicateOf: n.duplicateOf,
    })),
    notes: kept,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  fs.writeFileSync(OUT_PUBLIC, JSON.stringify(payload, null, 2), 'utf8');
  console.log('\nOK:', OUT_JSON);
  console.log('Stats:', payload.stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
