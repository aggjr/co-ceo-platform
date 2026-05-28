const fs = require('fs');
const events = JSON.parse(fs.readFileSync('ledger_rows.json', 'utf8'));
let sum = 0;
for (const e of events) {
  if (e.broker_note_ref === 'OPENING-MYPROFIT-2025-12-31') {
    sum += Number(e.total_gross_value);
    console.log(`${e.asset_id} | ${e.total_gross_value}`);
  }
}
console.log('SUM:', sum);
