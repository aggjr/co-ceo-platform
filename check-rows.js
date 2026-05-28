const fs = require('fs');
const { buildBrokerageNoteReviewRows } = require('./src/core/invest/brokerageNotesReviewFromLedger.js');

const events = JSON.parse(fs.readFileSync('ledger_rows.json', 'utf8'));
const rows = buildBrokerageNoteReviewRows(events);

for (const r of rows) {
  if (r.underlyingTicker === 'TESOURO-SELIC-2031') {
    console.log(`Date: ${r.transactionDate} | Type: ${r.tradeType} | Qty: ${r.quantity} | UnitPrice: ${r.unitPrice} | Gross: ${r.grossValue}`);
  }
}
