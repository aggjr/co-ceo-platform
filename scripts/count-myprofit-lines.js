require('ts-node/register/transpile-only');
const path =
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';
const mod = require('../src/core/invest/MyProfitHistoricalParser');
const lines = mod.parseMyProfitHistoricalFile(path, { fromDate: '2026-01-01' });
const refs = new Set();
let dup = 0;
for (const l of lines) {
  const r = l.broker_note_ref || '';
  if (refs.has(r)) dup += 1;
  refs.add(r);
}
console.log({ lines: lines.length, uniqueRefs: refs.size, dup });
