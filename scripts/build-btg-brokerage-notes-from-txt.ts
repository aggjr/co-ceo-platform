/**
 * Constroi o JSON de conferencia de notas BTG (consumido pelo
 * import-btg-brokerage-notes-ledger.ts) a partir dos arquivos *_ALL.txt
 * ja extraidos em "dados importação/documentos_txt_extraidos/".
 *
 * Diferenca de build-btg-brokerage-notes-review.ts (que extrai ZIPs +
 * converte PDF -> texto via pdfjs): esse aqui le diretamente os TXTs ja
 * existentes, mais leve e funciona offline.
 *
 * Uso (PowerShell):
 *   npx ts-node scripts/build-btg-brokerage-notes-from-txt.ts "dados importação/documentos_txt_extraidos"
 *
 * Saida: data/invest/btg-brokerage-notes-review-2026.json
 */
import fs from 'fs';
import path from 'path';
import {
  parseBtgBrokerageNoteBlocks,
  dedupeBrokerageNotes,
  flattenNotesForReview,
  type BtgBrokerageNote,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';

const DEFAULT_DIR = path.join(__dirname, '..', 'dados importação', 'documentos_txt_extraidos');
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

function inferCategoryFromName(name: string): BtgNoteCategory {
  const u = name.toUpperCase();
  if (u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

function* walk(d: string): Generator<string> {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('_ALL.txt') && !entry.name.endsWith('_SUMMARY_ALL.txt')) yield full;
  }
}

async function main() {
  const dir = process.argv[2] || DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    console.error('Pasta nao encontrada:', dir);
    process.exit(1);
  }

  const allNotes: BtgBrokerageNote[] = [];
  const files = [...walk(dir)];
  console.log(`Encontrei ${files.length} arquivos *_ALL.txt em ${dir}\n`);

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    const lines = text.split(/\r?\n/);
    const cat = inferCategoryFromName(path.basename(f));
    const rel = path.relative(dir, f).replace(/\\/g, '/');
    const parsed = parseBtgBrokerageNoteBlocks(lines, rel, cat);
    console.log(`  ${rel}  →  ${parsed.length} notas`);
    allNotes.push(...parsed);
  }

  const { kept, skipped } = dedupeBrokerageNotes(allNotes);
  const rows = flattenNotesForReview(kept);
  const payload = {
    generatedAt: new Date().toISOString(),
    ledgerImport: false,
    purpose: 'Conferencia de notas de corretagem antes do livro caixa',
    source: 'documentos_txt_extraidos (build-btg-brokerage-notes-from-txt)',
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
