/**
 * Extrai texto de PDFs IR BTG (senha = CPF sem pontuação) para conferência de abertura.
 * Uso: node scripts/extract-ir-pdf-tables.mjs <pdf1> [pdf2...]
 */
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const PASSWORD = process.env.IR_PDF_PASSWORD || '10293469687';

async function extractPdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({ data, password: PASSWORD, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let line = [];
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
    pages.push({ page: i, lines });
  }
  return { file: path.basename(filePath), pages };
}

function parseTablesFromText(pages, sourceFile) {
  const rows = [];
  const totals = [];
  for (const { page, lines } of pages) {
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (/patrim[oô]nio|total|saldo|consolidado|valor de mercado|situa[cç][aã]o/i.test(line)) {
        const money = line.match(/R\$\s*[\d.,]+/g);
        if (money) totals.push({ sourceFile, page, line, valores: money });
      }
      // Linha típica: ticker + números (qty, preço, valor)
      const tickerMatch = line.match(
        /\b([A-Z]{4}\d{1,2}|[A-Z]{4}[A-X]\d{1,3}|TESOURO[^\s]*|CDB[^\s]*|LCI[^\s]*|LCA[^\s]*|CAIXA[^\s]*)\b/i
      );
      if (!tickerMatch) continue;
      const nums = [...line.matchAll(/[\d]{1,3}(?:\.[\d]{3})*,[\d]{2}|\d+,\d{2}|\d+\.\d{2}/g)].map((m) => m[0]);
      if (nums.length < 2) continue;
      rows.push({
        sourceFile,
        page,
        ativo: tickerMatch[1].toUpperCase(),
        linha: line,
        numeros: nums,
      });
    }
  }
  return { rows, totals };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Informe ao menos um PDF.');
  process.exit(1);
}

const all = [];
for (const f of files) {
  const abs = path.resolve(f);
  if (!fs.existsSync(abs)) {
    console.error('Arquivo não encontrado:', abs);
    process.exit(1);
  }
  const text = await extractPdfText(abs);
  const parsed = parseTablesFromText(text.pages, text.file);
  all.push({ file: text.file, fullText: text, ...parsed });
}

const outDir = path.join(process.cwd(), 'data', 'invest', 'ir-extract');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const jsonPath = path.join(outDir, `ir-btg-2025-extract-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2), 'utf8');

console.log('=== Extração IR BTG ===\n');
for (const doc of all) {
  console.log(`\n## ${doc.file}`);
  console.log('\n### Totais / patrimônio mencionados');
  for (const t of doc.totals.slice(0, 30)) {
    console.log(`  p.${t.page}: ${t.line}`);
  }
  console.log('\n### Linhas com ativo (amostra estruturada)');
  for (const r of doc.rows.slice(0, 80)) {
    console.log(`  p.${r.page} | ${r.ativo} | ${r.numeros.join(' | ')} | ${r.linha.slice(0, 120)}`);
  }
  if (doc.rows.length > 80) console.log(`  ... +${doc.rows.length - 80} linhas`);
}
console.log(`\nJSON completo: ${jsonPath}`);
