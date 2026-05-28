import { normalizeBtgExtractPdfText } from './src/core/invest/btgExtractPdfText';
import fs from 'fs';

async function main() {
  const { createRequire } = await import('module');
  const nodeRequire = createRequire(__filename);
  const { getDocument } = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs');

  const pdfPath = "G:\\Meu Drive\\01 - Nova Estrutura\\Jan_2026.pdf";
  const buf = fs.readFileSync(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY = null;
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
  const raw = lines.join('\n');
  const norm = normalizeBtgExtractPdfText(raw);
  fs.writeFileSync('jan_2026_norm.txt', norm, 'utf8');
}
main().catch(console.error);
