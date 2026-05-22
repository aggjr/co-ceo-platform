/**
 * Dry-run das notas de corretagem BTG (SPOT, OPTIONS, ALUGUEL).
 *
 * Le os .txt extraidos do PDF, parseia via parseBtgBrokerageNoteBlocks,
 * faz dedup global, e mostra:
 *   - Quantas notas por categoria (SPOT/OPTIONS/LOAN)
 *   - Quantas trades por categoria
 *   - Soma do "Liquido para X" de cada nota (= efeito no caixa)
 *   - Diff esperado vs o saldo do extrato (importado separado)
 *
 * Uso:
 *   npx ts-node scripts/dryrun-btg-notes.ts "dados importação/documentos_txt_extraidos"
 */
import fs from 'fs';
import path from 'path';
import {
  parseBtgBrokerageNoteBlocks,
  dedupeBrokerageNotes,
  type BtgBrokerageNote,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: ts-node scripts/dryrun-btg-notes.ts <pasta_com_txt>');
  process.exit(1);
}

const abs = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
if (!fs.existsSync(abs)) {
  console.error(`Pasta nao encontrada: ${abs}`);
  process.exit(1);
}

// Aceita SOMENTE arquivos *_ALL.txt (sem _SUMMARY, que tem layout diferente
// e que o parser nao consegue reconhecer como bloco "NOTA DE CORRETAGEM").
function* walk(d: string): Generator<string> {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('_ALL.txt')) yield full;
  }
}

function inferCategoryFromName(name: string): BtgNoteCategory {
  const u = name.toUpperCase();
  if (u.includes('ALUGUEL')) return 'LOAN';
  if (u.includes('OPTIONS')) return 'OPTIONS';
  return 'SPOT';
}

/** Extrai "Liquido para DD/MM/YYYY [CD] <valor>" no texto do bloco. */
const LIQ_RE = /Líquido para (\d{2}\/\d{2}\/\d{4}) ([CD])\s*([\d.,-]+)/i;
function findLiquidoPara(noteSource: string): {
  date: string;
  dc: 'C' | 'D';
  amount: number;
} | null {
  const m = noteSource.match(LIQ_RE);
  if (!m) return null;
  const [, dateBr, dc, amountStr] = m;
  const [dd, mm, yyyy] = dateBr!.split('/');
  const amount = Number(amountStr!.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return { date: `${yyyy}-${mm}-${dd}`, dc: dc as 'C' | 'D', amount };
}

/** Para notas LOAN, "Valor líquido" tipico no resumo. */
const LOAN_LIQ_RE = /Valor\s+l[ií]quido\s+R\$\s*([\d.,-]+)/i;
const LOAN_DATE_RE = /Data de Liquida[cç][aã]o\s*(\d{2}\/\d{2}\/\d{4})/i;
function findLoanLiquido(noteSource: string): { date: string; amount: number } | null {
  const dateM = noteSource.match(LOAN_DATE_RE);
  if (!dateM) return null;
  const [dd, mm, yyyy] = dateM[1]!.split('/');
  // Pega ULTIMO "Valor liquido" (o do resumo total da nota, nao de cada contrato).
  let lastAmount: number | null = null;
  const re = /Valor\s+l[ií]quido\s+R\$\s*([\d.,-]+)/gi;
  let mm2;
  while ((mm2 = re.exec(noteSource)) !== null) {
    const v = Number(mm2[1]!.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(v)) lastAmount = v;
  }
  if (lastAmount == null) return null;
  return { date: `${yyyy}-${mm}-${dd}`, amount: lastAmount };
}

const files = [...walk(abs)];
console.log(`Encontrei ${files.length} arquivos *_ALL.txt em ${dir}\n`);

const allNotes: Array<BtgBrokerageNote & { sourceText: string }> = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf-8');
  const lines = text.split(/\r?\n/);
  const cat = inferCategoryFromName(path.basename(f));
  const parsed = parseBtgBrokerageNoteBlocks(lines, f, cat);
  for (const note of parsed) {
    // Para cada nota, recupera o texto cru do bloco (entre NOTA DE CORRETAGEM / NOTA DE EMPRESTIMO).
    // Para simplificar e termos o "Liquido para" e taxas, anexamos o texto inteiro do arquivo
    // (a nota e identificada pelo noteNumber dentro dele).
    allNotes.push({ ...note, sourceText: text });
  }
}

const { kept, skipped } = dedupeBrokerageNotes(allNotes);
console.log(`Notas extraidas: ${allNotes.length}   |   Apos dedup: ${kept.length}   |   Duplicatas: ${skipped.length}\n`);

type Agg = { count: number; trades: number; liquido: number };
const byCat: Record<BtgNoteCategory, Agg> = {
  SPOT: { count: 0, trades: 0, liquido: 0 },
  OPTIONS: { count: 0, trades: 0, liquido: 0 },
  LOAN: { count: 0, trades: 0, liquido: 0 },
};

let totalLiquido = 0;
const liquidosPorData: Record<string, number> = {};

for (const note of kept as Array<BtgBrokerageNote & { sourceText: string }>) {
  byCat[note.category].count += 1;
  byCat[note.category].trades += note.trades.length;

  if (note.category === 'LOAN') {
    const loan = findLoanLiquido(note.sourceText);
    if (loan) {
      const sinal = +1; // BTC doador sempre recebe
      const signed = sinal * loan.amount;
      byCat.LOAN.liquido += signed;
      totalLiquido += signed;
      liquidosPorData[loan.date] = (liquidosPorData[loan.date] || 0) + signed;
    }
  } else {
    // Tenta achar "Liquido para X C|D valor" no bloco da nota.
    // sourceText e o arquivo inteiro: recortamos pela noteNumber e ate a proxima
    // ocorrencia de "Nr. nota" (que marca o inicio da proxima nota no arquivo).
    const idx = note.sourceText.indexOf(note.noteNumber);
    let slice = note.sourceText;
    if (idx >= 0) {
      // Recorta ate a PROXIMA nota (proximo "NOTA DE CORRETAGEM"), nao ate o
      // proximo "Nr. nota" (que pode estar na mesma nota se cru estiver colado).
      const next = note.sourceText.indexOf('NOTA DE CORRETAGEM', idx + note.noteNumber.length);
      slice = note.sourceText.slice(idx, next >= 0 ? next : note.sourceText.length);
    }
    const liq = findLiquidoPara(slice);
    if (liq) {
      const signed = liq.dc === 'C' ? +liq.amount : -liq.amount;
      byCat[note.category].liquido += signed;
      totalLiquido += signed;
      liquidosPorData[liq.date] = (liquidosPorData[liq.date] || 0) + signed;
    } else {
      console.log(`  [warn] sem "Liquido para" na nota ${note.noteNumber} (${note.category}, ${note.pregaoDate})`);
    }
  }
}

console.log('Resumo por categoria:');
console.log(`  SPOT    : ${String(byCat.SPOT.count).padStart(3)} notas  | ${String(byCat.SPOT.trades).padStart(3)} trades | liquido R$ ${byCat.SPOT.liquido.toFixed(2)}`);
console.log(`  OPTIONS : ${String(byCat.OPTIONS.count).padStart(3)} notas  | ${String(byCat.OPTIONS.trades).padStart(3)} trades | liquido R$ ${byCat.OPTIONS.liquido.toFixed(2)}`);
console.log(`  LOAN    : ${String(byCat.LOAN.count).padStart(3)} notas  | ${String(byCat.LOAN.trades).padStart(3)} trades | liquido R$ ${byCat.LOAN.liquido.toFixed(2)}`);
console.log(`\nLiquido total das notas (efeito no caixa): R$ ${totalLiquido.toFixed(2)}`);

const DIFF_EXTRATO = -801857.33; // diff conhecido (extrato sem LIQ BOLSA = +R$ 801.857,33 sobrando)
console.log(`\nDiff do extrato (saldo previsto - saldo real): R$ ${(-DIFF_EXTRATO).toFixed(2)}`);
console.log(`Soma esperada das notas (deve casar com o diff): R$ ${DIFF_EXTRATO.toFixed(2)}`);
console.log(`Liquido total das notas (atual)               : R$ ${totalLiquido.toFixed(2)}`);
console.log(`Diff entre liquido das notas e diff do extrato: R$ ${(totalLiquido - DIFF_EXTRATO).toFixed(2)}`);
console.log(`  (Se for ~ 0, o casamento caixa <-> custodia esta consistente.)`);

console.log('\nTop 10 dias com maior fluxo liquido das notas:');
const sorted = Object.entries(liquidosPorData).sort(
  (a, b) => Math.abs(b[1]) - Math.abs(a[1])
);
for (const [date, v] of sorted.slice(0, 10)) {
  console.log(`  ${date}: R$ ${v.toFixed(2)}`);
}

// ----------------------------------------------------------------------------
// Sanity check independente do parser: soma TODOS os "Liquido para" unicos
// achados nos arquivos *_ALL.txt e nos LOAN. Pega o noteNumber da folha imediatamente
// anterior ao "Liquido para" para deduplicar por nota.
// ----------------------------------------------------------------------------
console.log('\n--- Sanity check independente: soma "Liquido para" + LOAN "Valor liquido" unicos ---');

const seenLiq = new Set<string>();
let sanity = 0;
let sanityCount = 0;

for (const f of files) {
  const text = fs.readFileSync(f, 'utf-8');
  const name = path.basename(f);
  if (name.includes('ALUGUEL')) {
    // Para ALUGUEL, soma "Valor liquido" do resumo geral da nota (ultima ocorrencia).
    const blocks = text.split(/NOTA DE EMPR[ÉE]STIMO/i).slice(1);
    for (const block of blocks) {
      const noteNum = (block.match(/Número da Nota\s*(\d+)/i) || [, ''])[1];
      const dateM = block.match(/Data de Liquida[cç][aã]o\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (!noteNum || !dateM) continue;
      const key = `LOAN|${noteNum}|${dateM[1]}`;
      if (seenLiq.has(key)) continue;
      seenLiq.add(key);
      // pega ULTIMO "Valor liquido R$ X,YZ" (do resumo)
      const all = [...block.matchAll(/Valor\s+l[ií]quido\s+R\$\s*([\d.,-]+)/gi)];
      if (!all.length) continue;
      const lastValue = all[all.length - 1]![1]!;
      const amount = Number(lastValue.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(amount)) continue;
      sanity += amount;
      sanityCount += 1;
    }
    continue;
  }

  // Para SPOT/OPTIONS: itera por todas as ocorrencias "Liquido para X CD valor"
  // e deduplica pelo (date, dc, amount) — duas folhas da mesma nota geram o mesmo
  // "Liquido para" repetido NO MESMO arquivo (em folha 1 visualizamos o "Liquido para"
  // que pertence a nota anterior; em folha N visualizamos o proprio).
  // Vamos deduplicar pela chave (arquivo, posicao do match dentro do arquivo) =
  // contamos cada "Liquido para" UMA VEZ por arquivo. Como cada arquivo cobre 1 mes
  // sem overlap, isso ja basta.
  const re = /Líquido para (\d{2}\/\d{2}\/\d{4}) ([CD])\s*([\d.,-]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, dateBr, dc, amountStr] = m;
    const amount = Number(amountStr!.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    // dedup global por (arquivo+offset) ja garantido. Mas dois arquivos diferentes
    // (ex. periodo 04 e periodo 04-05) podem repetir a mesma nota. Dedup por
    // (categoria, data, dc, valor) — risco baixo de colisao real (mesmo valor exato
    // no mesmo dia em notas diferentes e raro).
    const cat = name.includes('OPTIONS') ? 'OPTIONS' : 'SPOT';
    const key = `${cat}|${dateBr}|${dc}|${amount.toFixed(2)}`;
    if (seenLiq.has(key)) continue;
    seenLiq.add(key);
    sanity += dc === 'C' ? amount : -amount;
    sanityCount += 1;
  }
}

console.log(`Sanity: ${sanityCount} liquidos unicos somam R$ ${sanity.toFixed(2)}`);
console.log(`Esperado (diff do extrato): R$ -801857.33`);
console.log(`Diff sanity vs esperado   : R$ ${(sanity - DIFF_EXTRATO).toFixed(2)}`);
