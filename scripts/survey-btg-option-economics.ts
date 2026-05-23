/**
 * Levantamento: custo de venda de opção e de exercício (notas BTG parseadas).
 * Não grava no livro — só estatísticas para decisão de lote mínimo / exercício.
 *
 *   npx ts-node scripts/survey-btg-option-economics.ts
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  dedupeBrokerageNotes,
  parseBtgBrokerageNoteBlocks,
  type BtgBrokerageNote,
  type BtgBrokerageNoteTrade,
  type BtgNoteCategory,
} from '../src/core/invest/btgBrokerageNoteParser';
import { isOptionTicker } from '../src/core/invest/assetClassifier';

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

const NOTAS_ROOT = path.join(process.cwd(), 'local-import/btg-sources/notas-corretagem');
const OUT_DIR = path.join(process.cwd(), 'local-import/btg-sources/auditoria');

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
  if (u.includes('/OPTIONS/')) return 'OPTIONS';
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

function noteTotalFees(note: BtgBrokerageNote): number {
  const fromFields =
    Math.abs(note.settlementTax ?? 0) +
    Math.abs(note.registrationTax ?? 0) +
    Math.abs(note.emoluments ?? 0) +
    Math.abs(note.irrf ?? 0);
  if (fromFields > 0) return fromFields;
  return note.fees.reduce((s, f) => s + Math.abs(f.amount), 0);
}

function feeBreakdown(note: BtgBrokerageNote) {
  return {
    settlement: Math.abs(note.settlementTax ?? 0),
    registration: Math.abs(note.registrationTax ?? 0),
    emoluments: Math.abs(note.emoluments ?? 0),
    irrf: Math.abs(note.irrf ?? 0),
    cblc: Math.abs(note.cblcTotal ?? 0),
    bovespa: Math.abs(note.bovespaTotal ?? 0),
    total: noteTotalFees(note),
  };
}

function allocateFees(
  trade: BtgBrokerageNoteTrade,
  trades: BtgBrokerageNoteTrade[],
  totalFees: number
): number {
  const grossAll = trades.reduce((s, t) => s + Math.abs(t.grossValue), 0);
  if (grossAll <= 0) return totalFees;
  return (Math.abs(trade.grossValue) / grossAll) * totalFees;
}

type TradeKind = 'option_sell' | 'option_buy' | 'exercise' | 'spot_other';

function classifyTrade(t: BtgBrokerageNoteTrade, cat: BtgNoteCategory): TradeKind {
  if (t.isExercise || /EXERC/i.test(t.marketType)) return 'exercise';
  const opt = isOptionTicker(t.ticker) || /OPCAO/i.test(t.marketType);
  if (opt && t.side === 'V') return 'option_sell';
  if (opt && t.side === 'C') return 'option_buy';
  if (cat === 'OPTIONS' && t.side === 'V') return 'option_sell';
  if (cat === 'OPTIONS' && t.side === 'C') return 'option_buy';
  return 'spot_other';
}

type SellRow = {
  pregaoDate: string;
  noteNumber: string;
  ticker: string;
  underlying: string;
  operationLabel: string;
  quantity: number;
  unitPrice: number;
  grossPremium: number;
  feesAllocated: number;
  netPremium: number;
  feePctOfGross: number;
  feePerContract: number;
  feePerRealPremium: number;
  feesDetail: ReturnType<typeof feeBreakdown>;
};

type ExerciseRow = {
  pregaoDate: string;
  noteNumber: string;
  category: BtgNoteCategory;
  ticker: string;
  underlying: string;
  operationLabel: string;
  sideLabel: string;
  quantity: number;
  unitPrice: number;
  grossValue: number;
  feesNoteTotal: number;
  feesAllocated: number;
  netValue: number;
  feePctOfGross: number;
  allTradesOnNote: number;
};

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

function bucketQty(q: number): string {
  if (q <= 100) return '1-100';
  if (q <= 500) return '101-500';
  if (q <= 2500) return '501-2500';
  if (q <= 10000) return '2501-10000';
  return '10000+';
}

function stats(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    sum,
    min: s[0] ?? 0,
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s[s.length - 1] ?? 0,
    mean: s.length ? sum / s.length : 0,
  };
}

async function main() {
  if (!fs.existsSync(NOTAS_ROOT)) {
    console.error('Pasta não encontrada:', NOTAS_ROOT);
    process.exit(1);
  }

  const pdfs = listPdfs(NOTAS_ROOT);
  const allNotes: BtgBrokerageNote[] = [];
  for (const pdf of pdfs) {
    const lines = await pdfToLines(pdf);
    const cat = inferCategory(pdf);
    allNotes.push(...parseBtgBrokerageNoteBlocks(lines, pdf, cat));
  }
  const { kept } = dedupeBrokerageNotes(allNotes);

  const sells: SellRow[] = [];
  const exercises: ExerciseRow[] = [];

  for (const note of kept) {
    if (note.category === 'LOAN') continue;
    const fees = feeBreakdown(note);
    const totalFees = fees.total;

    for (const t of note.trades) {
      const kind = classifyTrade(t, note.category);
      const gross = Math.abs(t.grossValue);
      const alloc = allocateFees(t, note.trades, totalFees);

      if (kind === 'option_sell') {
        const net = gross - alloc;
        sells.push({
          pregaoDate: note.pregaoDate,
          noteNumber: note.noteNumber,
          ticker: t.ticker,
          underlying: t.underlyingStock,
          operationLabel: t.operationLabel,
          quantity: t.quantity,
          unitPrice: t.unitPrice,
          grossPremium: gross,
          feesAllocated: alloc,
          netPremium: net,
          feePctOfGross: gross > 0 ? (alloc / gross) * 100 : 0,
          feePerContract: t.quantity > 0 ? alloc / t.quantity : 0,
          feePerRealPremium: gross > 0 ? alloc / gross : 0,
          feesDetail: fees,
        });
      }

      if (kind === 'exercise') {
        exercises.push({
          pregaoDate: note.pregaoDate,
          noteNumber: note.noteNumber,
          category: note.category,
          ticker: t.ticker,
          underlying: t.underlyingStock,
          operationLabel: t.operationLabel,
          sideLabel: t.sideLabel,
          quantity: t.quantity,
          unitPrice: t.unitPrice,
          grossValue: gross,
          feesNoteTotal: totalFees,
          feesAllocated: alloc,
          netValue: t.side === 'C' ? -(gross + alloc) : gross - alloc,
          feePctOfGross: gross > 0 ? (alloc / gross) * 100 : 0,
          allTradesOnNote: note.trades.length,
        });
      }
    }
  }

  const byBucket = new Map<string, SellRow[]>();
  for (const s of sells) {
    const b = bucketQty(s.quantity);
    const arr = byBucket.get(b) ?? [];
    arr.push(s);
    byBucket.set(b, arr);
  }

  const bucketSummary = [...byBucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, rows]) => ({
      bucket,
      count: rows.length,
      feePct: stats(rows.map((r) => r.feePctOfGross)),
      feePerContract: stats(rows.map((r) => r.feePerContract)),
      grossPremium: stats(rows.map((r) => r.grossPremium)),
      feesAllocated: stats(rows.map((r) => r.feesAllocated)),
    }));

  const sellFeePct = stats(sells.map((s) => s.feePctOfGross));
  const sellFeePerContract = stats(sells.map((s) => s.feePerContract));
  const sellGross = stats(sells.map((s) => s.grossPremium));

  const exFeePct = stats(exercises.map((e) => e.feePctOfGross));
  const exGross = stats(exercises.map((e) => e.grossValue));
  const exFees = stats(exercises.map((e) => e.feesAllocated));

  const examplesSmallSell = sells
    .filter((s) => s.grossPremium < 500)
    .sort((a, b) => b.feePctOfGross - a.feePctOfGross)
    .slice(0, 15);

  const examplesLargeSell = sells
    .filter((s) => s.grossPremium >= 5000)
    .sort((a, b) => a.feePctOfGross - b.feePctOfGross)
    .slice(0, 8);

  const exerciseByNote = new Map<string, ExerciseRow[]>();
  for (const e of exercises) {
    const k = `${e.pregaoDate}|${e.noteNumber}`;
    const arr = exerciseByNote.get(k) ?? [];
    arr.push(e);
    exerciseByNote.set(k, arr);
  }

  const exerciseNotes = [...exerciseByNote.entries()].map(([key, legs]) => ({
    key,
    pregaoDate: legs[0]!.pregaoDate,
    noteNumber: legs[0]!.noteNumber,
    legs: legs.length,
    totalGross: legs.reduce((s, l) => s + l.grossValue, 0),
    feesNoteTotal: legs[0]!.feesNoteTotal,
    feePctOfGross:
      legs.reduce((s, l) => s + l.grossValue, 0) > 0
        ? (legs[0]!.feesNoteTotal / legs.reduce((s, l) => s + l.grossValue, 0)) * 100
        : 0,
    detail: legs,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    source: { pdfs: pdfs.length, notesKept: kept.length },
    methodology: {
      fees:
        'Por nota: taxa liquidação + registro + emolumentos + IRRF (campos do parser). Rateio proporcional ao valor bruto de cada linha na mesma nota.',
      optionSell: 'Venda de opção (OPTIONS, lado V, sem exercício).',
      exercise:
        'Linhas com EXERC / isExercise — pode ser perna da opção (ticker …E) ou fluxo na nota SPOT/OPTIONS.',
      breakEvenHint:
        'Prêmio líquido mínimo ≈ taxas da nota; para lote pequeno compare feePerContract vs prêmio unitário × qty.',
    },
    optionSells: {
      count: sells.length,
      feePctOfGross: sellFeePct,
      feePerContract: sellFeePerContract,
      grossPremium: sellGross,
      byQuantityBucket: bucketSummary,
      examplesHighFeePctSmallPremium: examplesSmallSell,
      examplesLowFeePctLargePremium: examplesLargeSell,
    },
    exercises: {
      tradeLines: exercises.length,
      distinctNotes: exerciseNotes.length,
      feePctOfGross: exFeePct,
      grossNotional: exGross,
      feesAllocated: exFees,
      notes: exerciseNotes.sort((a, b) => b.totalGross - a.totalGross).slice(0, 25),
    },
    decisionGuide: buildDecisionGuide(sells, bucketSummary, exerciseNotes),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(
    OUT_DIR,
    `levantamento-custos-opcoes-${new Date().toISOString().slice(0, 10)}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  printReport(report, outPath);
}

function buildDecisionGuide(
  sells: SellRow[],
  buckets: Array<{ bucket: string; feePct: { median: number; p75: number }; feePerContract: { median: number } }>,
  exerciseNotes: Array<{ totalGross: number; feesNoteTotal: number; feePctOfGross: number; legs: number }>
) {
  const medianFeePerContract =
    sells.length > 0
      ? quantile(
          [...sells.map((s) => s.feePerContract)].sort((a, b) => a - b),
          0.5
        )
      : 0;
  const small = buckets.find((b) => b.bucket === '1-100');
  const large = buckets.find((b) => b.bucket === '2501-10000') ?? buckets.find((b) => b.bucket === '10000+');

  return {
    vendaOpcao: {
      taxaFixaTipicaPorContratoMediana: round4(medianFeePerContract),
      feePctMedianoLote1a100: small ? round2(small.feePct.median) : null,
      feePctMedianoLoteGrande: large ? round2(large.feePct.median) : null,
      regraPratica:
        'Compare (taxas da nota) com (prêmio bruto). Se taxas > ~5–10% do prêmio, lote pequeno provavelmente não compensa — salvo edge estratégico.',
      premioBrutoMinimoIndicativo:
        medianFeePerContract > 0
          ? `Para ~100 contratos, prêmio bruto alvo > R$ ${round2(medianFeePerContract * 100 * 10)} (taxa ~10% do bruto) — ajuste pelo seu ticket médio.`
          : null,
    },
    exercicio: {
      feePctMedianoSobreNotional: exerciseNotes.length
        ? round2(
            quantile(
              [...exerciseNotes.map((n) => n.feePctOfGross)].sort((a, b) => a - b),
              0.5
            )
          )
        : null,
      regraPratica:
        'Exercício: taxas são % minúsculo sobre o notional da ação (dezenas/centenas de milhares). Vale exercer quando a estratégia exige o papel; o custo de corretagem/emolumentos na nota de exercício costuma ser irrelevante vs decisão de preço/strike.',
      atencao:
        'PUT vendida exercida: prêmio já recebido entra no PM B3; CALL/compra: somar custo do exercício ao PM. Comparar com alternativa (comprar/vender no mercado no dia).',
    },
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function printReport(report: Record<string, unknown>, outPath: string) {
  const os = report.optionSells as Record<string, unknown>;
  const ex = report.exercises as Record<string, unknown>;
  const guide = report.decisionGuide as Record<string, Record<string, unknown>>;

  console.log('=== Levantamento custos — opções BTG (notas parseadas) ===\n');
  console.log(`Notas: ${(report.source as { notesKept: number }).notesKept} | PDFs: ${(report.source as { pdfs: number }).pdfs}`);
  console.log('\n--- Venda de opção ---');
  console.log(`Operações: ${os.count}`);
  const fp = os.feePctOfGross as { median: number; p75: number; min: number; max: number };
  const fc = os.feePerContract as { median: number; p25: number; p75: number };
  const gp = os.grossPremium as { median: number; p25: number; p75: number };
  console.log(`Taxa % sobre prêmio bruto: mediana ${fp.median.toFixed(2)}% | P75 ${fp.p75.toFixed(2)}% | min ${fp.min.toFixed(2)}% | max ${fp.max.toFixed(2)}%`);
  console.log(`Taxa R$/contrato (rateada): mediana R$ ${fc.median.toFixed(4)} | P25 ${fc.p25.toFixed(4)} | P75 ${fc.p75.toFixed(4)}`);
  console.log(`Prêmio bruto R$: mediana ${gp.median.toFixed(2)} | P25 ${gp.p25.toFixed(2)} | P75 ${gp.p75.toFixed(2)}`);
  console.log('\nPor tamanho do lote (contratos):');
  for (const b of os.byQuantityBucket as Array<{
    bucket: string;
    count: number;
    feePct: { median: number };
    feePerContract: { median: number };
  }>) {
    console.log(
      `  ${b.bucket.padEnd(12)} n=${String(b.count).padStart(3)}  taxa% mediana ${b.feePct.median.toFixed(2)}%  R$/contr mediana ${b.feePerContract.median.toFixed(4)}`
    );
  }
  console.log('\n--- Exercício ---');
  console.log(`Linhas de negócio: ${ex.tradeLines} | Notas com exercício: ${ex.distinctNotes}`);
  const ef = ex.feePctOfGross as { median: number };
  const eg = ex.grossNotional as { median: number };
  console.log(`Notional bruto mediano: R$ ${eg.median.toLocaleString('pt-BR')}`);
  console.log(`Taxa % sobre notional: mediana ${ef.median.toFixed(4)}%`);
  console.log('\n--- Guia rápido ---');
  console.log(JSON.stringify(guide, null, 2));
  console.log(`\nJSON completo: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
