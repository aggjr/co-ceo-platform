import fs from 'fs';
import path from 'path';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';

async function walkDir(dir: string): Promise<string[]> {
  const result: string[] = [];
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      result.push(...await walkDir(fullPath));
    } else if (f.endsWith('.pdf')) {
      result.push(fullPath);
    }
  }
  return result;
}

async function main() {
  const dir = `G:/Meu Drive/01 - Nova Estrutura/`;
  const pdfs = await walkDir(dir);
  console.log(`Found ${pdfs.length} PDFs. Searching for 89.291 or 89291...`);
  
  for (const pdf of pdfs) {
    try {
      const buffer = fs.readFileSync(pdf);
      const text = await pdfBufferToText(buffer);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('89.29') || line.includes('8929')) {
          console.log(`FOUND in ${pdf}:\n  ${line}`);
        }
      }
    } catch (err: any) {
      // console.error(`Error reading ${pdf}`);
    }
  }
}

main().catch(console.error);
