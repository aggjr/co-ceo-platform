/**
 * Releitura do extrato BTG (PDF fresco) vs pernas duplicadas no livro.
 *
 *   npx ts-node scripts/releitura-extrato-duplicatas.ts
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';

dotenv.config();

const nodeRequire = createRequire(__filename);
const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs');

const PDF = path.join(process.cwd(), 'local-import/btg-sources/extrato/extrato.pdf');
const OUT = path.join(process.cwd(), 'local-import/btg-sources/extrato');

async function pdfToText(pdfPath: string): Promise<string> {
  const buf = fs.readFileSync(pdfPath);
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
  return lines.join('\n');
}

type LiqBolsa = {
  settleDate: string;
  pregaoDate: string;
  movement: number;
  balance?: number;
  raw: string;
};

function parseLiqLines(normalized: string): LiqBolsa[] {
  const out: LiqBolsa[] = [];
  const re =
    /^(\d{2})\/(\d{2})\/(\d{4})\s+LIQ BOLSA \(Operacoes\)-\s*Preg[aã]o:(\d{2})\/(\d{2})\/(\d{4})\s+(-?[\d.]+,\d{2})\s*\t\s*(-?[\d.]+,\d{2})/i;
  for (const line of normalized.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const [, sd, sm, sy, pd, pm, py, balStr, movStr] = m;
    const br = (s: string) => {
      const neg = s.startsWith('-');
      const n = Number(s.replace(/^-/, '').replace(/\./g, '').replace(',', '.'));
      return neg ? -n : n;
    };
    out.push({
      settleDate: `${sy}-${sm}-${sd}`,
      pregaoDate: `${py}-${pm}-${pd}`,
      movement: br(movStr!),
      balance: br(balStr!),
      raw: line.trim(),
    });
  }
  return out;
}

async function main() {
  if (!fs.existsSync(PDF)) {
    console.error('PDF não encontrado:', PDF);
    process.exit(1);
  }

  console.log('Extraindo PDF (pdfjs)...');
  const raw = await pdfToText(PDF);
  fs.writeFileSync(path.join(OUT, 'Extrato-raw.txt'), raw, 'utf8');

  const normalized = normalizeBtgExtractPdfText(raw);
  fs.writeFileSync(path.join(OUT, 'extrato-normalized.txt'), normalized, 'utf8');
  console.log(`Normalizado: ${normalized.split('\n').length} linhas\n`);

  const liqs = parseLiqLines(normalized);
  console.log(`LIQ BOLSA (Operações) no extrato: ${liqs.length} linhas\n`);

  for (const target of ['2026-04-27', '2026-04-28']) {
    const hits = liqs.filter((l) => l.pregaoDate === target);
    console.log(`--- Pregão ${target} ---`);
    if (!hits.length) {
      console.log('  (nenhuma LIQ BOLSA com esse pregão no extrato)\n');
      continue;
    }
    for (const h of hits) {
      console.log(
        `  Liquidação ${h.settleDate} | movimento extrato: R$ ${h.movement.toFixed(2)} | saldo após: R$ ${(h.balance ?? 0).toFixed(2)}`
      );
    }
    if (hits.length === 1) {
      console.log('  → UMA liquidação consolidada no banco para este pregão.\n');
    } else {
      console.log(`  → ${hits.length} liquidações LIQ BOLSA para o mesmo pregão.\n`);
    }
  }

  // Busca textual por valores dos duplicados
  console.log('--- Valores isolados no extrato (raw/normalizado) ---');
  for (const v of ['311,67', '623,34', '110,15', '220,30']) {
    const inNorm = normalized.includes(v);
    console.log(`  R$ ${v}: ${inNorm ? 'aparece' : 'não aparece'} no texto normalizado`);
  }

  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.log('\n(DB não consultado — sem senha)');
    return;
  }

  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
    user: process.env.REMOTE_DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || 'co_ceo_platform',
  });
  const org = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

  console.log('\n--- Livro razão (pernas :CASH duplicadas) ---');
  const pairs = [
    { note: '31582497', pregao: '2026-04-27', refs: ['#8', '#9'], ticker: 'PRIOE710', cashEach: 311.67 },
    { note: '31609259', pregao: '2026-04-28', refs: ['#4', '#5'], ticker: 'ITUBQ436', cashEach: 110.15 },
  ];

  for (const p of pairs) {
    const lineNums = p.refs.map((s) => s.replace('#', ''));
    let sum = 0;
    let count = 0;
    for (const ln of lineNums) {
      const fullRef = `BTG-NOTA-${p.note}#${p.pregao}#${ln}`;
      const [fin] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT amount, direction FROM financial_ledger_entries
         WHERE organization_id=? AND deleted_at IS NULL AND external_ref=?`,
        [org, `BROKER_REF:${fullRef}:CASH`]
      );
      for (const r of fin) {
        count++;
        const signed = r.direction === 'out' ? -Number(r.amount) : Number(r.amount);
        sum += signed;
      }
    }
    const liq = liqs.find((l) => l.pregaoDate === p.pregao);
    console.log(`\nNota ${p.note} (${p.ticker}) pregão ${p.pregao}:`);
    console.log(`  Livro: ${count} perna(s) :CASH × ~R$ ${p.cashEach} → soma R$ ${sum.toFixed(2)}`);
    console.log(`  Extrato LIQ BOLSA: ${liq ? `1 linha, R$ ${liq.movement.toFixed(2)}` : 'sem LIQ para este pregão'}`);
    if (count === 2 && liq && Math.abs(Math.abs(liq.movement) - Math.abs(p.cashEach)) < 1) {
      console.log(
        '  → Extrato ≈ valor de UMA perna; livro tem DUAS. Provável duplicata de import — void 1 par (patrimônio + :CASH).'
      );
    } else if (count === 2 && liq && Math.abs(Math.abs(liq.movement) - Math.abs(sum)) < 5) {
      console.log('  → Extrato ≈ soma das duas pernas — manter ambas no livro.');
    } else if (count === 2) {
      console.log(
        '  → Duas pernas no livro; LIQ do extrato é consolidada do dia inteiro — conferir PDF da nota se há 2 negócios iguais.'
      );
    }
  }

  await pool.end();

  const reportPath = path.join(
    process.cwd(),
    'local-import/btg-sources/auditoria',
    `releitura-extrato-${new Date().toISOString().slice(0, 10)}.json`
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), liqs, lineCount: normalized.split('\n').length }, null, 2),
    'utf8'
  );
  console.log(`\nRelatório: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
