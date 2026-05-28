import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<any[]>(
    `SELECT transaction_date, transaction_type, total_net_value, broker_note_ref, asset_ticker 
     FROM financial_ledger_entries 
     WHERE organization_id = 'org-holding-001' AND asset_type = 'cash'
     ORDER BY transaction_date ASC, id ASC`
  );
  
  let balance = 0;
  let prevMonth = '';
  for (const r of rows) {
    const isOut = ['buy', 'capital_withdrawal', 'fee', 'call_buy', 'put_buy', 'penalty_b3'].includes(r.transaction_type);
    const amt = Number(r.total_net_value);
    const net = isOut ? -amt : amt;
    balance += net;
    
    const d = r.transaction_date.toISOString().slice(0, 10);
    const month = d.slice(0, 7);
    if (prevMonth && month !== prevMonth) {
      console.log(`--- End of ${prevMonth} Balance: ${balance.toFixed(2)} ---`);
    }
    prevMonth = month;
    // console.log(`${d} | ${r.transaction_type.padEnd(20)} | ${net.toFixed(2).padStart(10)} | ${r.broker_note_ref} | ${r.asset_ticker} | Bal: ${balance.toFixed(2)}`);
  }
  if (prevMonth) {
    console.log(`--- End of ${prevMonth} Balance: ${balance.toFixed(2)} ---`);
  }
  
  await pool.end();
}

main().catch(console.error);
