import fs from 'fs';
import { parseExtractUploadImportLines } from '../src/core/invest/btgUploadImportService';

async function main() {
  const month = process.argv[2] || 'Mar';
  const filePath = `G:/Meu Drive/01 - Nova Estrutura/${month}_2026.pdf`;
  const buffer = fs.readFileSync(filePath);
  
  const file = {
    name: filePath,
    contentBase64: buffer.toString('base64'),
  };
  
  const lines = await parseExtractUploadImportLines(file);
  
  console.log(`--- Parsed lines for ${month} ---`);
  for (const line of lines) {
    console.log(line);
  }
}

main().catch(console.error);
