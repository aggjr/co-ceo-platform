/**
 * Converte Extrato.pdf (BTG conta corrente) em Extrato-normalized.txt para parser/reconciliação.
 * Uso: npx ts-node scripts/convert-btg-extract-pdf.ts [caminho.pdf]
 */
import * as fs from 'fs';
import * as path from 'path';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';
import {
  extractMovementBlock,
  lastExtractCashPoint,
  parseExtractCashSeries,
} from '../src/core/invest/btgExtractCashSeries';

async function readPdfTextWithPdfJs(pdfPath: string): Promise<string> {
  const { createRequire } = await import('module');
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
  const buf = fs.readFileSync(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line: string[] = [];
    for (const item of content.items) {
      const y = Math.round(item.transform[5]!);
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (line.length) lines.push(line.join(' ').trim());
        line = [];
      }
      line.push(item.str);
      lastY = y;
    }
    if (line.length) lines.push(line.join(' ').trim());
  }
  return lines.join('\n');
}

function readPdfText(pdfPath: string): Promise<string> {
  const rawTxt = pdfPath.replace(/\.pdf$/i, '.txt');
  if (fs.existsSync(rawTxt)) {
    return Promise.resolve(fs.readFileSync(rawTxt, 'utf8'));
  }
  return readPdfTextWithPdfJs(pdfPath).catch(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
      const buf = fs.readFileSync(pdfPath);
      return pdfParse(buf).then((d) => d.text);
    } catch {
      throw new Error(
        `Nao foi possivel ler o PDF. Coloque ${rawTxt} ao lado do PDF ou instale pdfjs-dist.`
      );
    }
  });
}

async function main() {
  const defaultPdf = path.join(
    process.cwd(),
    'data',
    'invest',
    'sources',
    'btg-extracts',
    'Extrato.pdf'
  );
  const pdfPath = path.resolve(process.argv[2] || defaultPdf);
  const outDir = path.dirname(pdfPath);
  const base = path.basename(pdfPath, path.extname(pdfPath));
  const rawTxt = path.join(outDir, `${base}.txt`);
  const normTxt = path.join(outDir, `${base}-normalized.txt`);

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF não encontrado:', pdfPath);
    process.exit(1);
  }

  const raw = await readPdfText(pdfPath);
  fs.writeFileSync(rawTxt, raw, 'utf8');
  console.log('Raw text:', rawTxt, raw.length, 'chars');

  const normalized = normalizeBtgExtractPdfText(raw);
  fs.writeFileSync(normTxt, normalized, 'utf8');
  console.log('Normalized:', normTxt, normalized.split('\n').length, 'lines');

  const block = extractMovementBlock(normalized);
  const series = parseExtractCashSeries(block);
  const last = lastExtractCashPoint(series);
  console.log('Cash points:', series.length);
  console.log(
    'Último saldo:',
    last?.date,
    last?.balance?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    last?.description?.slice(0, 60)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
