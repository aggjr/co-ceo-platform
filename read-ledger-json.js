const fs = require('fs');
const { buildBrokerageNoteReviewRows } = require('./src/core/invest/brokerageNotesReviewFromLedger.ts'); // Wait, ts file, can't require directly in node without ts-node

const events = JSON.parse(fs.readFileSync('ledger_rows.json', 'utf8'));

for (const e of events) {
  if (e.asset_id === '295ea137-ebf7-4a25-b01b-2f2dcb8312a0') { // TESOURO-SELIC-2031
    console.log(e);
  }
}
