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

function readPdfText(pdfPath: string): Promise<string> {
  const rawTxt = pdfPath.replace(/\.pdf$/i, '.txt');
  if (fs.existsSync(rawTxt)) {
    return Promise.resolve(fs.readFileSync(rawTxt, 'utf8'));
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const buf = fs.readFileSync(pdfPath);
    return pdfParse(buf).then((d) => d.text);
  } catch {
    throw new Error(
      `Instale pdf-parse (npm install pdf-parse --no-save) ou coloque ${rawTxt} ao lado do PDF.`
    );
  }
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
  const rawTxt = path.join(outDir, 'Extrato.txt');
  const normTxt = path.join(outDir, 'Extrato-normalized.txt');

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
