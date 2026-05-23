const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./data/invest/btg-augusto-h1-2026.json', 'utf8'));
const entries = d.monthly_statements[0].entries;
const lft = entries.filter(e => e.ticker === 'LFT-20310301');
console.log('LFT entries:', lft.length);
lft.forEach((e, i) => {
  console.log(`[${i}] op=${e.operation} qty=${e.quantity} pu=${e.unit_price} notes=${e.notes || ''}`);
});
