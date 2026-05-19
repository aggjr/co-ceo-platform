const X = require('xlsx');

const p =
  process.argv[2] ||
  'c:/Users/aggjr/Downloads/myProfit - Relatório Histórico de investimentos - 122025-052026.xlsx';
const wb = X.readFile(p);
const raw = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
console.log('header', raw[2]);
const data = raw.slice(3).filter((r) => r[5]);
let c2026 = 0;
let c2025 = 0;
const groups = {};
for (const r of data) {
  const d = X.SSF.parse_date_code(r[0]);
  const iso = d
    ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    : '';
  if (iso >= '2026-01-01') c2026 += 1;
  else c2025 += 1;
  groups[r[6]] = (groups[r[6]] || 0) + 1;
}
console.log({ dataRows: data.length, c2026, c2025, groups });
console.log('sample 2026', data.find((r) => {
  const d = X.SSF.parse_date_code(r[0]);
  return d && d.y >= 2026;
}));
