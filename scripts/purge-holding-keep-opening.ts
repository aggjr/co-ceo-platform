/**
 * Remove movimentações INVEST da org, preservando abertura 01/01/2026 (saldo inicial).
 *
 * Mantém:
 *   - business_events com source_ref OPENING:2026-01-01 (e revisões do mesmo ref)
 *   - patrimony_ledger_entries / financial_ledger_entries ligados a esses eventos
 *
 * Recalcula quantity/acquisition_value dos patrimony_items a partir do livro restante.
 *
 * Uso:
 *   npx ts-node scripts/purge-holding-keep-opening.ts
 *   PORTFOLIO_ORG_ID=org-holding-001 npx ts-node scripts/purge-holding-keep-opening.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const OPENING_REF = process.env.OPENING_SOURCE_REF || 'OPENING:2026-01-01';
const OPENING_DATE = process.env.OPENING_DATE || '2026-01-01';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_platform',
    waitForConnections: true,
    connectionLimit: 4,
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [openingEvents] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, source_ref, event_kind
       FROM business_events
       WHERE organization_id = ?
         AND deleted_at IS NULL
         AND source_ref = ?`,
      [ORG, OPENING_REF]
    );
    const [openingLegEvents] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT business_event_id AS id
       FROM patrimony_ledger_entries
       WHERE organization_id = ?
         AND deleted_at IS NULL
         AND movement_type = 'opening_balance'
         AND transaction_date = ?
         AND business_event_id IS NOT NULL`,
      [ORG, OPENING_DATE]
    );
    const openingIds = [
      ...new Set([
        ...openingEvents.map((r) => String(r.id)),
        ...openingLegEvents.map((r) => String(r.id)),
      ]),
    ];
    if (!openingIds.length) {
      console.warn(
        `AVISO: nenhum business_event com source_ref=${OPENING_REF}. Nada será preservado por evento.`
      );
      console.warn('Verifique se a abertura já foi importada antes do purge.');
    } else {
      console.log(`Preservando ${openingIds.length} evento(s) de abertura:`, openingRefList(openingEvents));
    }

    const openingIn = openingIds.length ? openingIds : [];

    if (!openingIn.length) {
      const [openingLegCount] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
         WHERE organization_id = ?
           AND deleted_at IS NULL
           AND movement_type = 'opening_balance'
           AND transaction_date = ?`,
        [ORG, OPENING_DATE]
      );
      const n = Number(openingLegCount[0]?.n ?? 0);
      if (n === 0) {
        console.error(
          `ABORTO: nenhuma abertura (${OPENING_REF} / opening_balance em ${OPENING_DATE}). Purge cancelado.`
        );
        await conn.rollback();
        process.exit(1);
      }
      console.warn(`Sem header ${OPENING_REF}; preservando ${n} perna(s) opening_balance em ${OPENING_DATE}.`);
    }

    const openingInSql = openingIn.length ? openingIn : ['00000000-0000-0000-0000-000000000000'];

    if (DRY_RUN) {
      const [wouldPle] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM patrimony_ledger_entries
         WHERE organization_id = ?
           AND NOT (
             business_event_id IN (?)
             OR (movement_type = 'opening_balance' AND transaction_date = ?)
           )`,
        [ORG, openingInSql, OPENING_DATE]
      );
      console.log('DRY-RUN patrimony_ledger a remover:', wouldPle[0]?.n);
      await conn.rollback();
      return;
    }

    const [ple] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM patrimony_ledger_entries
       WHERE organization_id = ?
         AND NOT (
           business_event_id IN (?)
           OR (movement_type = 'opening_balance' AND transaction_date = ?)
         )`,
      [ORG, openingInSql, OPENING_DATE]
    );
    console.log('patrimony_ledger removidos:', ple.affectedRows);

    const [fle] = await conn.query<mysql.ResultSetHeader>(
      `DELETE FROM financial_ledger_entries
       WHERE organization_id = ?
         AND NOT (
           business_event_id IN (?)
           OR (
             transaction_date = ?
             AND (
               description LIKE '%Saldo inicial%'
               OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.legacy_op')) = 'opening_balance'
             )
           )
         )`,
      [ORG, openingInSql, OPENING_DATE]
    );
    console.log('financial_ledger removidos:', fle.affectedRows);

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
    console.log('business_events removidos:', be.affectedRows);

    const [orphanItems] = await conn.query<mysql.ResultSetHeader>(
      `DELETE pi FROM patrimony_items pi
       LEFT JOIN patrimony_ledger_entries ple ON ple.patrimony_item_id = pi.id
       WHERE pi.organization_id = ?
         AND ple.id IS NULL`,
      [ORG]
    );
    console.log('patrimony_items órfãos removidos:', orphanItems.affectedRows);

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
    console.log('patrimony_items: quantity/acquisition recalculados do livro restante.');

    const [ioe] = await conn.query<mysql.ResultSetHeader>(
      `DELETE ioe FROM invest_option_ext ioe
       LEFT JOIN patrimony_items pi ON pi.id = ioe.patrimony_item_id
       WHERE ioe.organization_id = ? AND pi.id IS NULL`,
      [ORG]
    );
    console.log('invest_option_ext órfãos:', ioe.affectedRows);

    const [ipe] = await conn.query<mysql.ResultSetHeader>(
      `DELETE ipe FROM invest_position_ext ipe
       LEFT JOIN patrimony_items pi ON pi.id = ipe.patrimony_item_id
       WHERE ipe.organization_id = ? AND pi.id IS NULL`,
      [ORG]
    );
    console.log('invest_position_ext órfãos:', ipe.affectedRows);

    for (const table of ['invest_portfolio_daily', 'invest_daily_snapshots']) {
      try {
        const [r] = await conn.query<mysql.ResultSetHeader>(
          `DELETE FROM \`${table}\` WHERE organization_id = ?`,
          [ORG]
        );
        console.log(`${table} removidos:`, r.affectedRows);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("doesn't exist")) throw e;
      }
    }

    await conn.commit();

    const [openingLegs] = await pool.query(
      `SELECT COUNT(*) AS n FROM patrimony_ledger_entries ple
       INNER JOIN business_events be ON be.id = ple.business_event_id
       WHERE ple.organization_id = ? AND be.source_ref = ?`,
      [ORG, OPENING_REF]
    );
    console.log('\nLançamentos de abertura preservados:', (openingLegs as { n: number }[])[0]?.n ?? 0);

    const [items] = await pool.query(
      `SELECT identifier, quantity, acquisition_value, status
       FROM patrimony_items WHERE organization_id = ? AND deleted_at IS NULL
       ORDER BY identifier`,
      [ORG]
    );
    console.log('Itens patrimoniais restantes:', items);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }

  console.log('\nPróximo: npx ts-node scripts/rebuild-holding-from-btg-notes.ts');
}

function openingRefList(rows: mysql.RowDataPacket[]): string {
  return rows.map((r) => `${r.event_kind}:${r.source_ref}`).join(', ');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
