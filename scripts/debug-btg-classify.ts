/**
 * Diagnostico: lista cada lancamento classificado do extrato BTG com
 * data, operacao, ticker, sinal e valor para identificar erros de classificacao.
 */
import fs from 'fs';
import path from 'path';
import { btgLinesToImportEntries } from '../src/core/invest/BtgExtractLineParser';
import { normalizeBtgExtractPdfText } from '../src/core/invest/btgExtractPdfText';

const OPENING_BALANCE = 58758.79;

const file = process.argv[2];
if (!file) {
  console.error('Uso: ts-node scripts/debug-btg-classify.ts <arquivo.txt>');
  process.exit(1);
}

const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
const raw = fs.readFileSync(abs, 'utf-8');
const normalized = raw.includes('Movimentação - Conta Corrente')
  ? normalizeBtgExtractPdfText(raw)
  : raw;

console.log('=== TXT NORMALIZADO ===');
console.log(normalized);
console.log('\n=== LANCAMENTOS CLASSIFICADOS ===');

const entries = btgLinesToImportEntries(normalized.split(/\r?\n/), OPENING_BALANCE);
for (const e of entries) {
  console.log(
    `${e.date}  ${e.operation.padEnd(20)} ${(e.ticker || '-').padEnd(18)} qty=${String(e.quantity).padStart(8)} v=${String(e.total_net_value).padStart(12)} | ${(e.notes || '').slice(0, 60)}`
  );
}
