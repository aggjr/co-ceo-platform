/**
 * Gera JSON de ordens RV/opções somente BTG Pactual (home broker).
 * Fonte: Excel "Relatório Histórico" onde a coluna documento = B3_BTG Pactual_…
 *
 * Uso: npx ts-node scripts/build-btg-orders-import.ts [caminho.xlsx]
 */
import fs from 'fs';
import path from 'path';
import {
  parseBtgHomeBrokerHistoricalFile,
  normalizeBtgOrdersPayload,
  isBtgHomeBrokerRef,
} from '../src/core/invest/btgHomeBrokerImport';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';

const DEFAULT_XLSX =
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';
const LEGACY_JSON = path.join(
  __dirname,
  '..',
  'data',
  'invest',
  'myprofit-augusto-h1-2026.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', 'invest', 'btg-orders-augusto-h1-2026.json');

function fromLegacyJson(): LedgerImportLine[] {
  const raw = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8')) as {
    entries?: LedgerImportLine[];
  };
  return normalizeBtgOrdersPayload(raw.entries || []);
}

function main() {
  const xlsxArg = process.argv[2];
  let entries: LedgerImportLine[];
  let sourceFile: string;

  if (xlsxArg && fs.existsSync(path.resolve(xlsxArg))) {
    const inPath = path.resolve(xlsxArg);
    sourceFile = inPath;
    entries = parseBtgHomeBrokerHistoricalFile(inPath, { fromDate: '2026-01-01' });
  } else if (fs.existsSync(LEGACY_JSON)) {
    console.warn(
      'XLSX não informado — migrando somente linhas B3_BTG Pactual de',
      LEGACY_JSON
    );
    sourceFile = LEGACY_JSON;
    entries = fromLegacyJson();
  } else {
    console.error('Informe o xlsx BTG ou mantenha', LEGACY_JSON);
    process.exit(1);
  }

  const dropped = entries.filter((e) => !isBtgHomeBrokerRef(e.broker_note_ref));
  if (dropped.length) {
    console.warn('Ignoradas', dropped.length, 'linhas sem ref BTG Pactual');
  }

  const payload = {
    opening_date: '2026-01-01',
    source_label: 'BTG Pactual home broker — jan–mai/2026',
    opening_positions: [],
    entries,
    meta: {
      source_file: sourceFile,
      generated_at: new Date().toISOString(),
      broker: 'BTG Pactual',
    },
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Written', OUT_PATH, 'entries', entries.length);
}

main();
