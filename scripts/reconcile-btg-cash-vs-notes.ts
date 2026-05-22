/**
 * Reconciliacao dia-a-dia: LIQ BOLSA (Operacoes) do extrato vs "Liquido para"
 * das notas BTG. Aponta os dias onde os lados divergem.
 *
 * - Lado caixa: extrai cada linha "LIQ BOLSA (Operacoes)- Pregão:DD/MM/YYYY" do
 *   extrato.txt, com data de liquidacao (data da linha) e movimento (com sinal
 *   resolvido pela mesma heuristica usada na importacao).
 * - Lado custodia: extrai cada "Liquido para DD/MM/YYYY C|D valor" dos *_ALL.txt
 *   das notas SPOT/OPTIONS. Dedup por (date, dc, amount).
 *
 * Imprime tabela: data | extrato | notas | diff. Sai com codigo 0 se tudo bate
 * (diff total < R$ 1), 1 caso contrario.
 *
 * Uso:
 *   npx ts-node scripts/reconcile-btg-cash-vs-notes.ts \
 *     "dados importação/Extrato.txt" \
 *     "dados importação/documentos_txt_extraidos"
 */
import fs from 'fs';
import path from 'path';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';

const extratoFile = process.argv[2];
const notesDir = process.argv[3];
if (!extratoFile || !notesDir) {
  console.error('Uso: ts-node scripts/reconcile-btg-cash-vs-notes.ts <extrato.txt> <pasta_notas>');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Lado caixa: LIQ BOLSA (Operacoes) do extrato
// -----------------------------------------------------------------------------
const extratoAbs = path.resolve(process.cwd(), extratoFile);
const extratoRaw = fs.readFileSync(extratoAbs, 'utf-8');
const normalized = extratoRaw.includes('Movimentação - Conta Corrente')
  ? normalizeBtgExtractPdfText(extratoRaw)
  : extratoRaw;
const normalizedLines = normalized.split(/\r?\n/);

type CashLine = {
  settleDate: string; // data da linha = data de liquidacao
  pregaoDate: string;
  amount: number; // sinal positivo = credito, negativo = debito
};

// linha apos normalize: "DD/MM/YYYY LIQ BOLSA (Operacoes)- Pregão:dd/mm/yyyy <saldo>\t<movimento>"
const LIQ_LINE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+LIQ BOLSA \(Operacoes\)-\s*Pregão:(\d{2})\/(\d{2})\/(\d{4})\s+(-?[\d.]+,\d{2})\s*\t\s*(-?[\d.]+,\d{2})/;

const cashLines: CashLine[] = [];
const cashByDate: Record<string, number> = {};
let prevBalance: number | null = null;

for (const line of normalizedLines) {
  // capta saldo inicial pra derivar sinal de cada movimento
  const initM = line.match(/^Saldo Inicial\s+(-?[\d.]+,\d{2})/);
  if (initM) {
    prevBalance = brToNumber(initM[1]!);
    continue;
  }
  // Pega TODAS as linhas (nao so LIQ BOLSA) pra atualizar prevBalance
  const dateM = line.match(/^(\d{2})\/(\d{2})\/(\d{4}).+?(-?[\d.]+,\d{2})\s*\t\s*(-?[\d.]+,\d{2})/);
  if (!dateM) continue;
  const balance = brToNumber(dateM[4]!);
  const movement = brToNumber(dateM[5]!);

  const isLiqBolsa = /LIQ BOLSA \(Operacoes\)-\s*Pregão:/.test(line);
  if (isLiqBolsa && prevBalance != null) {
    const liqM = line.match(LIQ_LINE_RE);
    if (liqM) {
      const [, dd, mm, yyyy, pd, pm, py] = liqM;
      // Determina sinal pela diferenca de saldo
      const sign = balance >= prevBalance ? +1 : -1;
      const signed = sign * Math.abs(movement);
      const settleDate = `${yyyy}-${mm}-${dd}`;
      const pregaoDate = `${py}-${pm}-${pd}`;
      cashLines.push({ settleDate, pregaoDate, amount: signed });
      cashByDate[settleDate] = (cashByDate[settleDate] || 0) + signed;
    }
  }
  prevBalance = balance;
}

function brToNumber(s: string): number {
  const neg = s.startsWith('-');
  const v = s.replace(/^-/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(v);
  return neg ? -n : n;
}

// -----------------------------------------------------------------------------
// Lado custodia: "Liquido para" das notas
// -----------------------------------------------------------------------------
const notesAbs = path.resolve(process.cwd(), notesDir);
type NoteLiq = {
  settleDate: string;
  cat: 'SPOT' | 'OPTIONS' | 'LOAN';
  dc: 'C' | 'D';
  amount: number; // assinado
  sourceFile: string;
};

const noteLiquidos: NoteLiq[] = [];
const seen = new Set<string>();
const notesByDate: Record<string, number> = {};

function* walk(d: string): Generator<string> {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('_ALL.txt')) yield full;
  }
}

for (const f of walk(notesAbs)) {
  const text = fs.readFileSync(f, 'utf-8');
  const name = path.basename(f);
  if (name.includes('ALUGUEL')) {
    // BTC: o efeito no caixa ja vem do extrato (Corretagem BTC + IR BTC + TAXA REMUNERAÇÃO).
    // As notas de emprestimo afetam SO o patrimonio (qty alugada), nao o caixa.
    // Por isso ignoramos na reconciliacao caixa<->notas.
    continue;
  }
  const cat: 'SPOT' | 'OPTIONS' = name.includes('OPTIONS') ? 'OPTIONS' : 'SPOT';
  const re = /Líquido para (\d{2}\/\d{2}\/\d{4}) ([CD])\s*([\d.,-]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, dateBr, dc, amountStr] = m;
    const amount = brToNumber(amountStr!);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const key = `${cat}|${dateBr}|${dc}|${amount.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [dd, mm, yyyy] = dateBr.split('/');
    const settleDate = `${yyyy}-${mm}-${dd}`;
    const signed = dc === 'C' ? +amount : -amount;
    noteLiquidos.push({ settleDate, cat, dc: dc as 'C' | 'D', amount: signed, sourceFile: name });
    notesByDate[settleDate] = (notesByDate[settleDate] || 0) + signed;
  }
}

// -----------------------------------------------------------------------------
// Cruzamento dia-a-dia
// -----------------------------------------------------------------------------
const allDates = new Set([...Object.keys(cashByDate), ...Object.keys(notesByDate)]);
const sortedDates = [...allDates].sort();

const totalCash = Object.values(cashByDate).reduce((s, v) => s + v, 0);
const totalNotes = Object.values(notesByDate).reduce((s, v) => s + v, 0);

console.log(`Lado caixa (extrato BTG):  ${cashLines.length} LIQ BOLSA, total R$ ${totalCash.toFixed(2)}`);
console.log(`Lado custodia (notas):     ${noteLiquidos.length} liquidos, total R$ ${totalNotes.toFixed(2)}`);
console.log(`Diff global (notas - caixa): R$ ${(totalNotes - totalCash).toFixed(2)}`);
console.log('');

console.log('Data        | Caixa (extrato)    | Notas (custodia)   | Diff (notas-caixa)');
console.log('------------+--------------------+--------------------+--------------------');
let totalDiff = 0;
for (const d of sortedDates) {
  const c = cashByDate[d] || 0;
  const n = notesByDate[d] || 0;
  const diff = n - c;
  totalDiff += diff;
  const mark = Math.abs(diff) > 0.02 ? '  <-- DIFF' : '';
  console.log(
    `${d}  | ${c.toFixed(2).padStart(18)} | ${n.toFixed(2).padStart(18)} | ${diff.toFixed(2).padStart(18)}${mark}`
  );
}
console.log('------------+--------------------+--------------------+--------------------');
console.log(`TOTAL       | ${totalCash.toFixed(2).padStart(18)} | ${totalNotes.toFixed(2).padStart(18)} | ${totalDiff.toFixed(2).padStart(18)}`);
