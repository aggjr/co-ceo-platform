import fs from 'fs';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';

async function main() {
  const month = process.argv[2] || 'Mar';
  const filePath = `G:/Meu Drive/01 - Nova Estrutura/${month}_2026.pdf`;
  const buffer = fs.readFileSync(filePath);
  const text = await pdfBufferToText(buffer);
  
  console.log(`--- RAW TEXT for ${month} ---`);
  console.log(text);
}

main().catch(console.error);
