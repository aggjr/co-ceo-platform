/**
 * Normaliza Extrato-raw-pdfjs.txt (pdfjs, um bloco por página) para extrato-normalized.txt.
 * Uso: npx ts-node scripts/normalize-btg-extract-pdfjs-raw.ts [entrada] [saida]
 */
import * as fs from 'fs';
import * as path from 'path';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';

const DEFAULT_IN = path.join(
  process.cwd(),
  'local-import/btg-sources/extrato/Extrato-raw-pdfjs.txt'
);
const DEFAULT_OUT = path.join(
  process.cwd(),
  'local-import/btg-sources/extrato/extrato-normalized.txt'
);

function main() {
  const inPath = path.resolve(process.argv[2] || DEFAULT_IN);
  const outPath = path.resolve(process.argv[3] || DEFAULT_OUT);
  if (!fs.existsSync(inPath)) {
    console.error('Arquivo não encontrado:', inPath);
    process.exit(1);
  }

  let raw = fs.readFileSync(inPath, 'utf8');
  raw = raw.replace(/\d+ de\s+\d+/gi, '\n');
  raw = raw.replace(/Total de Créditos[\s\S]*$/i, '');
  const pieces = raw
    .split(/(?=\d{2}\/\d{2}\/\d{4}\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const synthetic = pieces.join('\n');
  const normalized = normalizeBtgExtractPdfText(synthetic);

  fs.writeFileSync(outPath, normalized, 'utf8');
  const dated = normalized.split(/\r?\n/).filter((l) => /^\d{2}\/\d{2}\/\d{4}/.test(l.trim()));
  console.log(`Escrito ${outPath}: ${dated.length} lançamentos`);
  if (dated.length) {
    console.log('Primeiro:', dated[0]);
    console.log('Último:', dated[dated.length - 1]);
  }
}

main();
