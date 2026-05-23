/**
 * Auditoria de taxas em notas BTG (txt extraídos do PDF) e/ou gap nominal × líquido.
 *
 * Uso:
 *   npx ts-node scripts/audit-brokerage-note-fees.ts "caminho/documentos_txt_extraidos"
 *
 * Saída: quantas notas têm taxas parseadas, notas com gap suspeito (documento incompleto).
 */
import fs from 'fs';
import path from 'path';
import {
  parseBtgBrokerageNoteBlocks,
  dedupeBrokerageNotes,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: npx ts-node scripts/audit-brokerage-note-fees.ts <pasta_txt_ALL>');
  process.exit(1);
}

const abs = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
if (!fs.existsSync(abs)) {
  console.error(`Pasta não encontrada: ${abs}`);
  console.error('Baixe/extraia os PDFs BTG para *_ALL.txt e informe o caminho.');
  process.exit(1);
}

function* walk(d: string): Generator<string> {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('_ALL.txt')) yield full;
  }
}

function inferCategory(name: string): BtgNoteCategory {
  const u = name.toUpperCase();
  if (u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

const files = [...walk(abs)];
const allNotes = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf-8').split(/\r?\n/);
  allNotes.push(...parseBtgBrokerageNoteBlocks(lines, f, inferCategory(path.basename(f))));
}
const { kept } = dedupeBrokerageNotes(allNotes);

let withAnyFee = 0;
let withFullBreakdown = 0;
let gapSuspect = 0;
const gapSamples: string[] = [];

for (const note of kept) {
  if (note.category === 'LOAN') continue;
  const gross = note.trades.reduce((s, t) => s + Math.abs(t.grossValue), 0);
  const fees =
    Math.abs(note.settlementTax ?? 0) +
    Math.abs(note.registrationTax ?? 0) +
    Math.abs(note.emoluments ?? 0) +
    Math.abs(note.cblcTotal ?? 0) +
    Math.abs(note.bovespaTotal ?? 0) +
    Math.abs(note.irrf ?? 0);
  if (fees > 0) withAnyFee += 1;
  if (
    note.settlementTax != null &&
    note.emoluments != null &&
    note.bovespaTotal != null
  ) {
    withFullBreakdown += 1;
  }
  const net = Math.abs(note.netOperations ?? 0);
  if (gross > 0 && net > 0) {
    const implied = Math.abs(gross - net);
    const parsed = fees;
    if (implied > 0.05 && parsed < implied * 0.5) {
      gapSuspect += 1;
      if (gapSamples.length < 15) {
        gapSamples.push(
          `  nota ${note.noteNumber} ${note.pregaoDate}: nominal R$ ${gross.toFixed(2)} | líquido R$ ${net.toFixed(2)} | taxas parseadas R$ ${parsed.toFixed(2)} | gap implícito R$ ${implied.toFixed(2)}`
        );
      }
    }
  }
}

const spotOpt = kept.filter((n) => n.category !== 'LOAN');
console.log(`Arquivos *_ALL.txt: ${files.length}`);
console.log(`Notas (dedup): ${spotOpt.length}`);
console.log(`Com alguma taxa parseada: ${withAnyFee}`);
console.log(`Com breakdown completo (liq+emol+bovespa): ${withFullBreakdown}`);
console.log(`Gap nominal×líquido > taxas parseadas (documento incompleto?): ${gapSuspect}`);
if (gapSamples.length) {
  console.log('\nAmostras:');
  gapSamples.forEach((s) => console.log(s));
}
if (withAnyFee < spotOpt.length * 0.5) {
  console.log(
    '\n>>> Menos da metade das notas tem taxas no parser. Baixe PDFs completos ou confira layout do Resumo dos Negócios.'
  );
  process.exit(1);
}
