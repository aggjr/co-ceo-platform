import fs from 'fs';
import { pdfBufferToText } from '../src/core/invest/btgPdfTextExtract';

async function main() {
  const filePath = `G:/Meu Drive/01 - Nova Estrutura/Extrato.pdf`;
  const buffer = fs.readFileSync(filePath);
  const text = await pdfBufferToText(buffer);
  
  console.log(`--- RAW TEXT for Extrato.pdf ---`);
  console.log(text);
}

main().catch(console.error);
