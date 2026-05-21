import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function pdfText(buf) {
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
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
    lines.push(`--- page ${p} ---`);
  }
  return lines;
}

const sample = process.argv[2];
const buf = fs.readFileSync(sample);
const lines = await pdfText(buf);
console.log(lines.slice(0, 80).join('\n'));
