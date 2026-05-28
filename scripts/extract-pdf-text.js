/**
 * Extrai texto do PDF usando pdfjs-dist (mjs).
 */
const fs = require('fs');
const path = require('path');

const pdfPath = process.argv[2];
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error('Arquivo não encontrado:', pdfPath);
  process.exit(1);
}

async function main() {
  const pdfjs = await import('file:///' + path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs').replace(/\\/g, '/'));
  pdfjs.GlobalWorkerOptions.workerSrc = 'file:///' + path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').replace(/\\/g, '/');

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  console.log(`PDF: ${doc.numPages} páginas`);

  let allText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) lines.push('\n');
      lines.push(item.str);
      lastY = y;
    }
    allText += `\n=== Página ${i} ===\n` + lines.join('');
  }

  const outPath = pdfPath.replace(/\.pdf$/i, '_text.txt');
  fs.writeFileSync(outPath, allText, 'utf8');
  console.log(`Texto extraído: ${outPath}`);
  console.log(`Total chars: ${allText.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
