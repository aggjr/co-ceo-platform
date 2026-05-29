import fs from 'fs';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';

async function main() {
  const dir = `G:/Meu Drive/01 - Nova Estrutura/`;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  for (const f of files) {
    const buffer = fs.readFileSync(dir + f);
    const text = await pdfBufferToText(buffer);
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.includes('89.')) {
        console.log(`${f}: ${line}`);
      }
    }
  }
}

main().catch(console.error);
