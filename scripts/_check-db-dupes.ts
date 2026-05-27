import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  const dbName = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';
  
  if (!password && host === '127.0.0.1') {
    console.error('Missing DB_PASSWORD');
    return;
  }
  
  const conn = await mysql.createConnection({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: dbName
  });

  console.log(`Connected to ${dbName} @ ${host}`);

  // 1. Check zero-amount financial legs for corporate actions
  const [zeroFin] = await conn.query(`
    SELECT id, external_ref, metadata 
    FROM financial_ledger_entries 
    WHERE amount = 0 AND deleted_at IS NULL
  `);
  console.log(`Financial legs with amount = 0: ${(zeroFin as any).length}`);

  // 2. Check duplicate broker_note_refs in patrimony
  const [dupPat] = await conn.query(`
    SELECT external_ref, COUNT(*) as c
    FROM patrimony_ledger_entries
    WHERE external_ref IS NOT NULL AND deleted_at IS NULL
    GROUP BY external_ref
    HAVING c > 1
  `);
  console.log(`Patrimony duplicate external_refs: ${(dupPat as any).length}`);

  // 3. Check duplicate broker_note_refs in financial
  const [dupFin] = await conn.query(`
    SELECT external_ref, COUNT(*) as c
    FROM financial_ledger_entries
    WHERE external_ref IS NOT NULL AND deleted_at IS NULL
    GROUP BY external_ref
    HAVING c > 1
  `);
  console.log(`Financial duplicate external_refs: ${(dupFin as any).length}`);

  // 4. Check for cash legs duplication (same amount, same date, both missing external_ref or same text)
  const [dupCash] = await conn.query(`
    SELECT transaction_date, amount, direction, description, COUNT(*) as c
    FROM financial_ledger_entries
    WHERE deleted_at IS NULL
    GROUP BY transaction_date, amount, direction, description
    HAVING c > 1
  `);
  console.log(`Potential cash duplications (same date/amount/direction/desc): ${(dupCash as any).length}`);

  await conn.end();
}

main().catch(console.error);
