const fs = require('fs');
const events = JSON.parse(fs.readFileSync('ledger_rows.json', 'utf8'));

function eventFeeTotal(e) {
  return (
    Math.abs(Number(e.brokerage_fee ?? 0)) +
    Math.abs(Number(e.b3_fees ?? 0)) +
    Math.abs(Number(e.irrf_tax ?? 0))
  );
}

function nominalGross(e) {
  return Math.round(Math.abs(Number(e.quantity) || 0) * Math.abs(Number(e.unit_price) || 0) * 100) / 100;
}

for (const e of events) {
  if (e.asset_ticker === 'TESOURO-SELIC-2031') {
    const gross = nominalGross(e);
    console.log(`${e.transaction_date} | ${e.transaction_type} | qty=${e.quantity} | px=${e.unit_price} | net=${e.total_net_value} | gross=${gross}`);
  }
}
