/**
 * Gera JSON de import INVEST a partir de texto colado dos PDFs BTG.
 * Uso: npx ts-node scripts/build-btg-extract-import.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { btgLinesToImportEntries } from '../src/core/invest/BtgExtractLineParser';
import {
  BTG_EXTRACT_SOURCES,
  extractMovementBlock,
  loadBtgExtractCashDailySeries,
} from '../src/core/invest/btgExtractCashSeries';

const SOURCES = BTG_EXTRACT_SOURCES.map((s) => ({
  file: s.file,
  monthLabel: s.periodLabel,
  openingBalance: s.openingBalance,
}));

function main() {
  const srcDir = path.join(__dirname, '..', 'data', 'invest', 'sources', 'btg-extracts');
  const allEntries: ReturnType<typeof btgLinesToImportEntries> = [];
  const monthly: Array<{ month: string; broker: string; entries: typeof allEntries }> = [];

  for (const spec of SOURCES) {
    const fp = path.join(srcDir, spec.file);
    if (!fs.existsSync(fp)) {
      console.warn('Skip (missing):', fp);
      continue;
    }
    const text = fs.readFileSync(fp, 'utf8');
    const block = extractMovementBlock(text);
    const entries = btgLinesToImportEntries(block, spec.openingBalance);
    allEntries.push(...entries);
    monthly.push({ month: spec.monthLabel, broker: 'BTG', entries });
    console.log(spec.file, '→', entries.length, 'lançamentos');
  }

  const payload = {
    opening_date: '2026-01-01',
    source_label: 'BTG extrato conta corrente 01/01–21/05/2026 (Extrato.pdf emitido 21/05/2026)',
    opening_positions: [],
    entries: [],
    monthly_statements: monthly,
    meta: {
      account: '004176105',
      holder: 'Augusto Goncalves Gomes',
      broker: 'BTG Pactual',
      cash_opening_2026_01_01: 58758.79,
      note: 'opening_positions vazio — preencher com bolsa_pai_2025.pdf + Excel myProfit',
    },
  };

  const out = path.join(__dirname, '..', 'data', 'invest', 'btg-augusto-h1-2026.json');
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Written', out, 'total entries', allEntries.length);

  const cash = loadBtgExtractCashDailySeries(srcDir);
  const cashOut = path.join(__dirname, '..', 'data', 'invest', 'btg-extract-cash-daily.json');
  fs.writeFileSync(
    cashOut,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        sources: cash.sources.map((s) => s.file),
        points: cash.series,
        last: cash.series[cash.series.length - 1] ?? null,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('Written', cashOut, 'cash points', cash.series.length);
}

main();
