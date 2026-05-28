import { extractTextFromBtgPdf, parseBtgExtractText } from '../src/core/invest/btgExtractParser';

async function main() {
  const filePath = "G:/Meu Drive/01 - Nova Estrutura/Fev_2026.pdf";
  const { text } = await extractTextFromBtgPdf(filePath);
  const parsed = parseBtgExtractText(text);
  
  console.log('--- Parsed rows ---');
  for (const row of parsed.entries) {
    console.log(`${row.date} | ${row.description.padEnd(50)} | ${row.amount}`);
  }
  
  console.log('\n--- Full Text ---');
  console.log(text);
}

main().catch(console.error);
