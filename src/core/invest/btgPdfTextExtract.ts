/**
 * Extrai texto de PDF BTG (extrato / notas) para parsers do núcleo INVEST.
 */

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

async function loadPdfJs(): Promise<PdfJsModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<PdfJsModule>;
  return dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
}

export async function pdfBufferToText(buffer: Buffer): Promise<string> {
  const { getDocument } = await loadPdfJs();
  const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line: string[] = [];
    for (const item of content.items) {
      const y = Math.round((item as { transform: number[] }).transform[5]!);
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

export async function pdfBufferToLines(buffer: Buffer): Promise<string[]> {
  const text = await pdfBufferToText(buffer);
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
