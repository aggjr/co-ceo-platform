/**
 * Remove lançamentos INVEST de um mês (YYYY-MM), preservando abertura 01/01.
 *
 *   npx ts-node scripts/purge-invest-month.ts 2026-01
 *   npx ts-node scripts/purge-invest-month.ts 2026-01 --confirm
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const MONTH = process.argv[2] || '';
const CONFIRM = process.argv.includes('--confirm');
const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const OPENING_REF = process.env.OPENING_SOURCE_REF || 'OPENING:2026-01-01';
const OPENING_DATE = process.env.OPENING_DATE || '2026-01-01';

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) {
    console.error('Uso: ts-node scripts/purge-invest-month.ts YYYY-MM [--confirm]');
    process.exit(1);
  }

  const from = `${MONTH}-01`;
  const to = lastDayOfMonth(MONTH);
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const password = process.env.REMOTE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!password) {
    console.error('Defina DB_PASSWORD ou REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
    waitForConnections: true,
    connectionLimit: 4,
  });

  const conn = await pool.getConnection();
  try {
    const [openingEvents] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM business_events
       WHERE organization_id = ? AND deleted_at IS NULL AND source_ref = ?`,
      [ORG, OPENING_REF]
    );
    const openingIds = openingEvents.map((r) => String(r.id));
    if (!openingIds.length) {
      console.warn(`AVISO: sem evento ${OPENING_REF}; abertura por perna em ${OPENING_DATE}.`);
    }

    const openingInSql = openingIds.length ? openingIds : ['00000000-0000-0000-0000-000000000000'];

    const preservePle = `(movement_type = 'opening_balance' AND transaction_date = ?)`;
    const preserveFle = `(
      transaction_date = ?
      AND (
        description LIKE '%Saldo inicial%'
        OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'
      )
    )`;

    const [wouldPle] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
       WHERE organization_id = ?
         AND transaction_date >= ? AND transaction_date <= ?
         AND NOT (business_event_id IN (?) OR ${preservePle})`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    const [wouldFle] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM financial_ledger_entries
       WHERE organization_id = ?
         AND transaction_date >= ? AND transaction_date <= ?
         AND NOT (business_event_id IN (?) OR ${preserveFle})`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );

    console.log(`Purge ${MONTH} org=${ORG} @ ${host}`);
    console.log(`Período: ${from} → ${to}`);
    console.log(`patrimony_ledger a remover: ${wouldPle[0]?.n ?? 0}`);
    console.log(`financial_ledger a remover: ${wouldFle[0]?.n ?? 0}`);

    if (!CONFIRM) {
      console.log('\nDry-run. Rode com --confirm para executar.');
      return;
    }

    await conn.beginTransaction();

    const monthScopePle = `ple.organization_id = ? AND ple.transaction_date >= ? AND ple.transaction_date <= ?
         AND NOT (ple.business_event_id IN (?) OR ${preservePle.replace(/movement_type/g, 'ple.movement_type').replace(/transaction_date/g, 'ple.transaction_date')})`;
    const preserveFleFle = preserveFle
      .replace(/description/g, 'fle.description')
      .replace(/transaction_date/g, 'fle.transaction_date')
      .replace(/metadata/g, 'fle.metadata');
    const monthScopeFle = `fle.organization_id = ? AND fle.transaction_date >= ? AND fle.transaction_date <= ?
         AND NOT (fle.business_event_id IN (?) OR ${preserveFleFle})`;
    const monthScopePleBare = `organization_id = ? AND transaction_date >= ? AND transaction_date <= ?
         AND NOT (business_event_id IN (?) OR ${preservePle})`;
    const monthScopeFleBare = `organization_id = ? AND transaction_date >= ? AND transaction_date <= ?
         AND NOT (business_event_id IN (?) OR ${preserveFle})`;

    const [unlinkPle] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE patrimony_ledger_entries SET related_financial_entry_id = NULL
       WHERE ${monthScopePleBare}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('patrimony_ledger FK caixa desligadas (mês):', unlinkPle.affectedRows);

    const [unlinkPleForFin] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE patrimony_ledger_entries ple
       INNER JOIN financial_ledger_entries fle ON fle.id = ple.related_financial_entry_id
       SET ple.related_financial_entry_id = NULL
       WHERE ${monthScopeFle}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('patrimony_ledger FK caixa desligadas (fora do mês):', unlinkPleForFin.affectedRows);

    const [unlinkFle] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE financial_ledger_entries SET related_patrimony_ledger_id = NULL
       WHERE ${monthScopeFleBare}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('financial_ledger FK patrimônio desligadas (mês):', unlinkFle.affectedRows);

    const [unlinkFleForPle] = await conn.query<mysql.ResultSetHeader>(
      `UPDATE financial_ledger_entries fle
       INNER JOIN patrimony_ledger_entries ple ON ple.id = fle.related_patrimony_ledger_id
       SET fle.related_patrimony_ledger_id = NULL
       WHERE ${monthScopePle}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('financial_ledger FK patrimônio desligadas (fora do mês):', unlinkFleForPle.affectedRows);

    const [fle] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM financial_ledger_entries WHERE ${monthScopeFleBare}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('financial_ledger removidos:', fle.affectedRows);

    const [ple] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM patrimony_ledger_entries WHERE ${monthScopePleBare}`,
      [ORG, from, to, openingInSql, OPENING_DATE]
    );
    console.log('patrimony_ledger removidos:', ple.affectedRows);

    const [be] = await conn.query<mysql.ResultSetHeader>(
      `DELETE be FROM business_events be
       WHERE be.organization_id = ?
         AND be.deleted_at IS NULL
         AND be.source_ref <> ?
         AND NOT EXISTS (
           SELECT 1 FROM patrimony_ledger_entries ple
           WHERE ple.business_event_id = be.id AND ple.organization_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM financial_ledger_entries fle
           WHERE fle.business_event_id = be.id AND fle.organization_id = ?
         )`,
      [ORG, OPENING_REF, ORG, ORG]
    );
    console.log('business_events órfãos removidos:', be.affectedRows);

    const [orphanItems] = await conn.query<mysql.ResultSetHeader>(
      `DELETE pi FROM patrimony_items pi
       LEFT JOIN patrimony_ledger_entries ple ON ple.patrimony_item_id = pi.id
       WHERE pi.organization_id = ? AND ple.id IS NULL`,
      [ORG]
    );
    console.log('patrimony_items órfãos:', orphanItems.affectedRows);

    await conn.query(
      `UPDATE patrimony_items pi
       INNER JOIN (
         SELECT patrimony_item_id,
                SUM(quantity_delta) AS qty,
                SUM(total_value) AS tv
         FROM patrimony_ledger_entries
         WHERE organization_id = ?
         GROUP BY patrimony_item_id
       ) agg ON agg.patrimony_item_id = pi.id
       SET pi.quantity = agg.qty,
           pi.acquisition_value = agg.tv,
           pi.current_value = agg.tv
       WHERE pi.organization_id = ?`,
      [ORG, ORG]
    );

    for (const table of ['invest_portfolio_daily', 'invest_daily_snapshots']) {
      try {
        const [r] = await conn.query<mysql.ResultSetHeader>(
          `DELETE FROM \`${table}\` WHERE organization_id = ? AND snapshot_date >= ?`,
          [ORG, from]
        );
        console.log(`${table} removidos (>= ${from}):`, r.affectedRows);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("doesn't exist") && !msg.includes('Unknown column')) throw e;
      }
    }

    await conn.commit();
    console.log('\nPurge concluído. Próximo: npx ts-node scripts/reimport-btg-month.ts', MONTH);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
