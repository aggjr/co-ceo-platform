import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';

const DUMMY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Desfaz vínculos patrimonial ↔ financeiro antes do purge.
 * FKs: ple.related_financial_entry_id → fle.id e fle.related_patrimony_ledger_id → ple.id
 */
export async function clearLedgerCrossLinksByPreservedIds(
  conn: PoolConnection,
  orgId: string,
  preservedFinancialIds: string[],
  preservedPatrimonyIds: string[]
): Promise<{ pleUnlinked: number; fleUnlinked: number }> {
  const finIds = preservedFinancialIds.length ? preservedFinancialIds : [DUMMY_ID];
  const patIds = preservedPatrimonyIds.length ? preservedPatrimonyIds : [DUMMY_ID];
  const finPh = finIds.map(() => '?').join(',');
  const patPh = patIds.map(() => '?').join(',');

  const [pleRes] = await conn.query<ResultSetHeader>(
    `UPDATE patrimony_ledger_entries ple
     INNER JOIN financial_ledger_entries fle
       ON fle.id = ple.related_financial_entry_id AND fle.organization_id = ple.organization_id
     SET ple.related_financial_entry_id = NULL
     WHERE ple.organization_id = ?
       AND fle.id NOT IN (${finPh})`,
    [orgId, ...finIds]
  );

  const [fleRes] = await conn.query<ResultSetHeader>(
    `UPDATE financial_ledger_entries fle
     INNER JOIN patrimony_ledger_entries ple
       ON ple.id = fle.related_patrimony_ledger_id AND ple.organization_id = fle.organization_id
     SET fle.related_patrimony_ledger_id = NULL
     WHERE fle.organization_id = ?
       AND ple.id NOT IN (${patPh})`,
    [orgId, ...patIds]
  );

  return {
    pleUnlinked: pleRes.affectedRows,
    fleUnlinked: fleRes.affectedRows,
  };
}

/** Purge canônico (abertura por evento/data) — mesma regra de preserve do HoldingPurgeKeepOpeningService. */
export async function clearLedgerCrossLinksForOpeningPurge(
  conn: PoolConnection,
  orgId: string,
  openingDate: string,
  openingEventIds: string[]
): Promise<{ pleUnlinked: number; fleUnlinked: number }> {
  const openingInSql = openingEventIds.length ? openingEventIds : [DUMMY_ID];

  const preserveFle = `(
    fle.business_event_id IN (?)
    OR (
      fle.transaction_date = ?
      AND (
        fle.description LIKE '%Saldo inicial%'
        OR JSON_UNQUOTE(JSON_EXTRACT(fle.metadata, '$.legacy_op')) = 'opening_balance'
      )
    )
  )`;
  const preservePle = `(ple.business_event_id IN (?) OR (ple.movement_type = 'opening_balance' AND ple.transaction_date = ?))`;

  const [pleRes] = await conn.query<ResultSetHeader>(
    `UPDATE patrimony_ledger_entries ple
     INNER JOIN financial_ledger_entries fle
       ON fle.id = ple.related_financial_entry_id AND fle.organization_id = ple.organization_id
     SET ple.related_financial_entry_id = NULL
     WHERE ple.organization_id = ?
       AND NOT ${preserveFle}`,
    [orgId, openingInSql, openingDate]
  );

  const [fleRes] = await conn.query<ResultSetHeader>(
    `UPDATE financial_ledger_entries fle
     INNER JOIN patrimony_ledger_entries ple
       ON ple.id = fle.related_patrimony_ledger_id AND ple.organization_id = fle.organization_id
     SET fle.related_patrimony_ledger_id = NULL
     WHERE fle.organization_id = ?
       AND NOT ${preservePle}`,
    [orgId, openingInSql, openingDate]
  );

  return {
    pleUnlinked: pleRes.affectedRows,
    fleUnlinked: fleRes.affectedRows,
  };
}
