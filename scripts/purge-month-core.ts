import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const MONTH = process.argv[2] || '';
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) {
    console.error('Uso: ts-node purge-month-core.ts YYYY-MM');
    process.exit(1);
  }

  const from = `${MONTH}-01`;
  const to = lastDayOfMonth(MONTH);
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_db',
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const preservePle = `(movement_type = 'opening_balance' AND transaction_date = '2026-01-01')`;
    const preserveFle = `(
      transaction_date = '2026-01-01'
      AND (
        description LIKE '%Saldo inicial%'
        OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'
      )
    )`;

    const monthScopePle = `organization_id = ? AND transaction_date >= ? AND transaction_date <= ? AND NOT ${preservePle}`;
    const monthScopeFle = `organization_id = ? AND transaction_date >= ? AND transaction_date <= ? AND NOT ${preserveFle}`;

    const [unlinkPle] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE patrimony_ledger_entries SET related_financial_entry_id = NULL WHERE ${monthScopePle}`,
      [ORG, from, to]
    );
    console.log('patrimony_ledger FK caixa desligadas:', unlinkPle.affectedRows);

    const [unlinkFle] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE financial_ledger_entries SET related_patrimony_ledger_id = NULL WHERE ${monthScopeFle}`,
      [ORG, from, to]
    );
    console.log('financial_ledger FK patrimônio desligadas:', unlinkFle.affectedRows);

    const [fle] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM financial_ledger_entries WHERE ${monthScopeFle}`,
      [ORG, from, to]
    );
    console.log('financial_ledger removidos:', fle.affectedRows);

    const [ple] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM patrimony_ledger_entries WHERE ${monthScopePle}`,
      [ORG, from, to]
    );
    console.log('patrimony_ledger removidos:', ple.affectedRows);

    // Recalcular saldo patrimony_items
    await conn.query(
      `UPDATE patrimony_items pi
       LEFT JOIN (
         SELECT patrimony_item_id, SUM(quantity_delta) AS qty, SUM(total_value) AS tv
         FROM patrimony_ledger_entries WHERE organization_id = ? GROUP BY patrimony_item_id
       ) agg ON agg.patrimony_item_id = pi.id
       SET pi.quantity = IFNULL(agg.qty, 0),
           pi.acquisition_value = IFNULL(agg.tv, 0),
           pi.current_value = IFNULL(agg.tv, 0)
       WHERE pi.organization_id = ?`,
      [ORG, ORG]
    );
    
    // Deletar os zerados
    await conn.query(
      `DELETE FROM patrimony_items WHERE organization_id = ? AND quantity = 0 AND acquisition_value = 0`,
      [ORG]
    );

    for (const table of ['invest_portfolio_daily', 'invest_daily_snapshots']) {
      try {
        const [r] = await conn.query<mysql.ResultSetHeader>(
          `DELETE FROM \`${table}\` WHERE organization_id = ? AND snapshot_date >= ?`,
          [ORG, from]
        );
        console.log(`${table} removidos (>= ${from}):`, r.affectedRows);
      } catch (e) { }
    }

    await conn.commit();
    console.log(`\nPurge concluído para ${MONTH}.`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(console.error);
