import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const ORG = 'org-holding-001';

async function main() {
  const month = process.argv[2]; // e.g. "2026-01"
  const targetEndCashStr = process.argv[3]; // e.g. "3614.36"
  
  if (!month || !targetEndCashStr) {
    console.log('Usage: npx ts-node scripts/fix-monthly-cash-delta.ts YYYY-MM targetEndCash');
    process.exit(1);
  }
  
  const targetEndCash = parseFloat(targetEndCashStr);
  
  const d = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
  const endOfMonth = d.toISOString().split('T')[0];
  
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });
  
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) as currentBalance 
     FROM financial_ledger_entries 
     WHERE organization_id = ? AND transaction_date <= ?`,
    [ORG, endOfMonth]
  );
  
  const currentBalance = parseFloat(rows[0].currentBalance) || 0;
  const delta = targetEndCash - currentBalance;
  
  if (Math.abs(delta) < 0.01) {
    console.log(`Month ${month} cash is already matched! (${currentBalance.toFixed(2)})`);
    process.exit(0);
  }
  
  console.log(`Month ${month}: Current = ${currentBalance.toFixed(2)}, Target = ${targetEndCash.toFixed(2)}. Delta = ${delta.toFixed(2)}`);
  
  const direction = delta > 0 ? 'in' : 'out';
  const amount = Math.abs(delta);
  const desc = `Ajuste manual de caixa (mês ${month}) para fechar com extrato BTG`;
  const lastDay = month + '-31'; 
  
  // const d = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
  // const endOfMonth = d.toISOString().split('T')[0];
  
  const [accounts] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id FROM financial_accounts WHERE organization_id = ? AND external_id = 'BTG'`,
    [ORG]
  );
  const accountId = accounts[0].id;
  
  await pool.query(
    `INSERT INTO financial_ledger_entries 
     (id, organization_id, account_id, transaction_date, settlement_date, direction, amount, currency, description, status, external_ref, metadata)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'BRL', ?, 'cleared', ?, ?)`,
    [ORG, accountId, endOfMonth, endOfMonth, direction, amount, desc, `MANUAL-ADJ-${month}`, JSON.stringify({ legacy_op: direction === 'in' ? 'cash_yield' : 'fee' })]
  );
  
  console.log(`Inserted ${direction} of ${amount.toFixed(2)} on ${endOfMonth}`);
  
  await pool.end();
}

main().catch(console.error);
