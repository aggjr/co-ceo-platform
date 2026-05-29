import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Dani160779!',
    database: 'co_ceo_db'
  });

  const tables = [
    'financial_ledger_entries',
    'patrimony_ledger_entries',
    'invest_position_ext',
    'patrimony_items',
    'invest_portfolio_daily',
    'invest_patrimony_monthly_anchors'
  ];

  const orgId = 'org-holding-001';
  const dump: Record<string, any[]> = {};

  for (const table of tables) {
    const [rows] = await pool.query<any[]>(
      `SELECT * FROM ?? WHERE organization_id = ?`,
      [table, orgId]
    );
    dump[table] = rows;
  }

  const outPath = path.resolve(__dirname, '../src/database/seeds/invest_migration.json');
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`Dump written to ${outPath} (${Object.keys(dump).map(t => `${t}: ${dump[t].length}`).join(', ')})`);

  await pool.end();
}

main().catch(console.error);
