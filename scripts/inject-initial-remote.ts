import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || '69.62.99.34',
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_db',
  });

  const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

  try {
    // 1. Initial Cash
    console.log('Injecting initial cash...');
    const initCash = 58758.79;
    await pool.query(
      `INSERT INTO financial_ledger_entries 
        (id, organization_id, type, amount, status, effective_date, description, created_at, updated_at) 
       VALUES (UUID(), ?, 'DEPOSIT', ?, 'active', '2025-12-31 23:59:59', 'Saldo Inicial (Importado)', NOW(), NOW())`,
      [ORG, initCash]
    );

    // 2. Initial Positions
    console.log('Injecting initial positions...');
    const posData = JSON.parse(fs.readFileSync('initial-positions.json', 'utf8'));
    for (const pos of posData) {
      if (pos.identifier.includes('cash')) continue;
      await pool.query(
        `INSERT INTO patrimony_ledger_entries 
          (id, organization_id, portfolio_id, identifier, operation, quantity, unit_price, status, settlement_date, created_at, updated_at) 
         VALUES (UUID(), ?, 'holding-portfolio', ?, 'BUY', ?, 0, 'active', '2025-12-31 23:59:59', NOW(), NOW())`,
        [ORG, pos.identifier, pos.initialQuantity]
      );
    }

    console.log('Initial setup on remote done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
