/**
 * Gera JSON de lançamentos a partir do Excel myProfit.
 * Uso: npx ts-node scripts/build-myprofit-import.ts [caminho.xlsx]
 */
import fs from 'fs';
import path from 'path';
import { parseMyProfitHistoricalFile } from '../src/core/invest/MyProfitHistoricalParser';

const DEFAULT_XLSX =
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';

function main() {
  const inPath = path.resolve(process.argv[2] || DEFAULT_XLSX);
  const entries = parseMyProfitHistoricalFile(inPath, { fromDate: '2026-01-01' });
  const outPath = path.join(__dirname, '..', 'data', 'invest', 'myprofit-augusto-h1-2026.json');
  const payload = {
    opening_date: '2026-01-01',
    source_label: 'myProfit histórico 12/2025–05/2026',
    opening_positions: [],
    entries,
    meta: { source_file: inPath, generated_at: new Date().toISOString() },
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Written', outPath, 'entries', entries.length);
}

main();
