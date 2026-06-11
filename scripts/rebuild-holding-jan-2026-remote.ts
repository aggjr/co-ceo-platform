import 'dotenv/config';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway, SYSTEM_INSTALLER_USER_ID, type UserContext } from '../src/core/dal';
import { StorageMeter } from '../src/core/dal/StorageMeter';
import { buildInvestOperations } from '../src/modules/invest';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  applyBtgBrokerageUpload,
} from '../src/core/invest/btgUploadImportService';
import type { BtgUploadFileInput } from '../src/core/invest/btgUploadImportService';
import { BTG_MONTHS_2026, btgSourcesBase, listNotePdfs, resolveExtractPath, resolveNotesDir } from './lib/btg-2026-months';

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const MONTH = '2026-01';
const OPENING_DATE = '2026-01-01';
const CLOSING_DATE = '2026-01-31';

const TARGETS = {
  openingCash: 58_760.14,
  openingOperationalCash: 58_758.79,
  openingLftNet: 1_032_969.97,
  openingPrio3Net: 223_668.58,
  openingOptions: -110_545.92,
  openingNetPatrimony: 1_204_852.77,
  closingCash: 3_614.36,
  closingLftNet: 1_331_511.57,
  closingOptions: -27_656.62,
  closingNetPatrimony: 1_307_469.31,
};

const FINAL_MARKS: Record<string, number> = {
  'LFT-20310301': TARGETS.closingLftNet,
  PRIO3: 0,
  PRION410: -63.07,
  PRION415: -87.87,
  PRION44: -381.96,
  PRION45: -637.35,
  PRION460: -1_026.57,
  PRION470: -1_604.63,
  PRIOA407: 0,
  PRIOM385: 0,
  PRIOM405: 0,
  PRIOQ43: -20_804.39,
  PRIOR407: -3_050.78,
};

function toUpload(filePath: string, relBase: string): BtgUploadFileInput {
  return {
    name: path.relative(relBase, filePath).replace(/\\/g, '/'),
    contentBase64: fs.readFileSync(filePath).toString('base64'),
  };
}

function monthPaths() {
  const base = btgSourcesBase();
  const spec = BTG_MONTHS_2026.find((s) => s.month === MONTH);
  if (!spec) throw new Error(`Mes ${MONTH} nao configurado.`);
  const notesDir = resolveNotesDir(base, spec);
  if (!notesDir) throw new Error(`Pasta de notas ausente para ${MONTH}.`);
  const extract = resolveExtractPath(base, spec);
  if (!fs.existsSync(extract)) throw new Error(`Extrato ausente: ${extract}`);
  return { base, notesDir, extract };
}

async function tableExists(conn: mysql.PoolConnection, table: string): Promise<boolean> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function purgeHolding(conn: mysql.PoolConnection) {
  const tables = [
    'invest_reconcile_runs',
    'invest_reconciliation_sessions',
    'invest_patrimony_monthly_anchors',
    'invest_broker_custody_snapshot_positions',
    'invest_broker_custody_snapshots',
    'invest_daily_snapshots',
    'invest_portfolio_daily',
    'invest_cash_account_bindings',
    'financial_closings',
    'patrimony_closings',
    'patrimony_item_locations',
    'invest_option_ext',
    'invest_position_ext',
    'financial_ledger_entries',
    'patrimony_ledger_entries',
    'financial_accounts',
    'patrimony_locations',
    'patrimony_items',
    'business_events',
    'invest_ledger_entries',
    'invest_assets',
  ];

  let storageReset: { previousBytes: number } | null = null;
  await conn.beginTransaction();
  try {
    await conn.query(`SET FOREIGN_KEY_CHECKS = 0`);
    for (const table of tables) {
      if (!(await tableExists(conn, table))) continue;
      const [cols] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
      );
      const names = cols.map((r) => String(r.COLUMN_NAME));
      if (names.includes('organization_id')) {
        await conn.query(`DELETE FROM \`${table}\` WHERE organization_id = ?`, [ORG]);
      }
    }
    storageReset = await StorageMeter.resetOrganizationUsage(conn, ORG);
    await conn.query(`SET FOREIGN_KEY_CHECKS = 1`);
    await conn.commit();
  } catch (err) {
    await conn.query(`SET FOREIGN_KEY_CHECKS = 1`).catch(() => undefined);
    await conn.rollback();
    throw err;
  }
  return { storageReset };
}

async function recordCorrectOpening(pool: mysql.Pool) {
  const gateway = new CoCeoDataGateway(pool);
  const ops = buildInvestOperations(gateway);
  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: ORG,
    impersonatorId: null,
    scope: 'global',
  };

  const oldOptionNotional =
    31_200 * 1.426748 + 6_300 * 0.912254 + 5_400 * 0.626905;
  const optionScale = Math.abs(TARGETS.openingOptions) / oldOptionNotional;

  return ops.recordOpeningBatch(ctx, {
    asOfDate: OPENING_DATE,
    positions: [
      {
        ticker: 'PRIO3',
        assetClass: 'stock',
        quantity: 5_400,
        unitPrice: TARGETS.openingPrio3Net / 5_400,
        name: 'PRIO3',
        notes: 'Abertura BTG 31/12/2025 - renda variavel liquida',
        brokerNoteRef: `${OPENING_DATE}:PRIO3`,
      },
      {
        ticker: 'LFT-20310301',
        assetClass: 'fixed_income',
        quantity: 58,
        unitPrice: TARGETS.openingLftNet / 58,
        name: 'Tesouro Direto LFT 01/03/2031',
        notes: 'Abertura BTG 31/12/2025 - renda fixa liquida',
        brokerNoteRef: `${OPENING_DATE}:LFT-20310301`,
      },
      {
        ticker: 'PRIOQ43',
        assetClass: 'option_put',
        quantity: -31_200,
        unitPrice: 1.426748 * optionScale,
        optionUnderlying: 'PRIO3',
        optionStrike: 43.5,
        optionExpiration: '2026-05-15',
        optionType: 'PUT',
        notes: 'Abertura BTG 31/12/2025 - opcao vendida',
        brokerNoteRef: `${OPENING_DATE}:PRIOQ43`,
      },
      {
        ticker: 'PRIOR407',
        assetClass: 'option_put',
        quantity: -6_300,
        unitPrice: 0.912254 * optionScale,
        optionUnderlying: 'PRIO3',
        optionStrike: 40.75,
        optionExpiration: '2026-06-19',
        optionType: 'PUT',
        notes: 'Abertura BTG 31/12/2025 - opcao vendida',
        brokerNoteRef: `${OPENING_DATE}:PRIOR407`,
      },
      {
        ticker: 'PRIOA407',
        assetClass: 'option_call',
        quantity: -5_400,
        unitPrice: 0.626905 * optionScale,
        optionUnderlying: 'PRIO3',
        optionStrike: 40.75,
        optionExpiration: '2026-01-16',
        optionType: 'CALL',
        notes: 'Abertura BTG 31/12/2025 - opcao vendida',
        brokerNoteRef: `${OPENING_DATE}:PRIOA407`,
      },
    ],
    cashAccounts: [
      {
        brokerCode: 'BTG',
        accountName: 'Conta Corrente BTG',
        externalId: 'BTG',
        balance: TARGETS.openingCash,
      },
    ],
  });
}

async function ensureOpeningCashReference(conn: mysql.PoolConnection) {
  await conn.query(
    `UPDATE financial_ledger_entries
        SET external_ref = ?
      WHERE organization_id = ?
        AND transaction_date = ?
        AND description = 'Saldo inicial'
        AND deleted_at IS NULL`,
    [`OPENING-CASH-BTG-${OPENING_DATE}`, ORG, OPENING_DATE]
  );
}

async function applyClosingMarks(conn: mysql.PoolConnection) {
  for (const [ticker, value] of Object.entries(FINAL_MARKS)) {
    await conn.query(
      `UPDATE patrimony_items
          SET current_value = ?, updated_at = NOW()
        WHERE organization_id = ? AND identifier = ? AND deleted_at IS NULL`,
      [value, ORG, ticker]
    );
  }

  await conn.query(
    `INSERT INTO invest_patrimony_monthly_anchors
       (id, organization_id, reference_date, patrimony, source, notes)
     VALUES
       (?, ?, '2025-12-31', ?, 'BTG_EXTRATO_MENSAL', ?),
       (?, ?, ?, ?, 'BTG_EXTRATO_MENSAL', ?)
     ON DUPLICATE KEY UPDATE
       patrimony = VALUES(patrimony),
       source = VALUES(source),
       notes = VALUES(notes),
       updated_at = NOW()`,
    [
      `anchor-${ORG}-2025-12-31`,
      ORG,
      TARGETS.openingNetPatrimony,
      `BTG Jan/2026 resumo inicial: caixa=${TARGETS.openingCash}; LFT_liquido=${TARGETS.openingLftNet}; renda_variavel_liquida=${TARGETS.openingPrio3Net}; derivativos=${TARGETS.openingOptions}; fonte=BTG_extrato_mensal_conta_004176105_2026-01.pdf`,
      `anchor-${ORG}-${CLOSING_DATE}`,
      ORG,
      CLOSING_DATE,
      TARGETS.closingNetPatrimony,
      `BTG Jan/2026: bruto=1320481.60; caixa=${TARGETS.closingCash}; LFT_liquido=${TARGETS.closingLftNet}; opcoes=${TARGETS.closingOptions}; fonte=BTG_extrato_mensal_conta_004176105_2026-01.pdf`,
    ]
  );
}

async function importManualCashExtract(conn: mysql.PoolConnection) {
  const [accounts] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM financial_accounts
      WHERE organization_id = ? AND source_module = 'INVEST' AND external_id = 'BTG'
      LIMIT 1`,
    [ORG]
  );
  const accountId = String(accounts[0]?.id || '');
  if (!accountId) throw new Error('Conta financeira BTG nao encontrada.');

  const rows: Array<{
    date: string;
    description: string;
    amount: number;
    patrimony?: { quantity: number; unitValue: number };
  }> = [
    {
      date: '2026-01-01',
      description: 'AJUSTE ENTRE RESUMO BTG 31/12 E SALDO ANTERIOR OPERACIONAL DO EXTRATO',
      amount: TARGETS.openingOperationalCash - TARGETS.openingCash,
    },
    { date: '2026-01-06', description: 'LIQ BOLSA (OPERACOES)- PREGAO:05/01/2026', amount: 399.48 },
    { date: '2026-01-07', description: 'LIQ BOLSA (OPERACOES)- PREGAO:06/01/2026', amount: 1_797.60 },
    { date: '2026-01-09', description: 'COMPRA DE TESOURO DIRETO: LFT 01/03/2031', amount: -54_160.08, patrimony: { quantity: 3, unitValue: 18_053.36 } },
    { date: '2026-01-09', description: 'CONTA REMUNERADA - RESGATE REMUNERACAO - BANCO BTG PACTUAL S.A.', amount: 4.98 },
    { date: '2026-01-19', description: 'LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026)', amount: -1.72 },
    { date: '2026-01-19', description: 'LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA ESTORNO DE TAXA SOBRE POSICAO 1026)', amount: 1.72 },
    { date: '2026-01-20', description: 'LIQ BOLSA (OPERACOES)- PREGAO:16/01/2026', amount: 219_983.99 },
    { date: '2026-01-20', description: 'LIQ BOLSA (CORRETAGEM BTC ALUGUEL)', amount: -2.04 },
    { date: '2026-01-20', description: 'IR - BTC PRIO3', amount: -1.31 },
    { date: '2026-01-20', description: 'LIQ BOLSA (OPERACOES)- PREGAO:19/01/2026', amount: 3_495.32 },
    { date: '2026-01-20', description: 'TAXA REMUNERACAO - BTC PRIO3', amount: 5.84 },
    { date: '2026-01-21', description: 'TAXA REMUNERACAO - BTC PRIO3', amount: -0.21 },
    { date: '2026-01-21', description: 'TAXA EMOLUMENTOS - BTC PRIO3', amount: -0.97 },
    { date: '2026-01-21', description: 'REEMBOLSO DE CUSTODIA REMUNERADA - ALUGUEL', amount: 1.18 },
    { date: '2026-01-22', description: 'COMPRA DE TESOURO DIRETO: LFT 01/03/2031', amount: -181_453.40, patrimony: { quantity: 10, unitValue: 18_145.34 } },
    { date: '2026-01-27', description: 'LIQ BOLSA (OPERACOES)- PREGAO:26/01/2026', amount: 3_744.99 },
    { date: '2026-01-27', description: 'CONTA REMUNERADA - RESGATE REMUNERACAO - BANCO BTG PACTUAL S.A.', amount: 1.41 },
    { date: '2026-01-27', description: 'CONTA REMUNERADA - RESGATE REMUNERACAO - BANCO BTG PACTUAL S.A.', amount: 0.05 },
    { date: '2026-01-27', description: 'CONTA REMUNERADA - RESGATE REMUNERACAO - BANCO BTG PACTUAL S.A.', amount: 0.21 },
    { date: '2026-01-27', description: 'CONTA REMUNERADA - RESGATE REMUNERACAO - BANCO BTG PACTUAL S.A.', amount: 0.42 },
    { date: '2026-01-28', description: 'COMPRA DE TESOURO DIRETO: LFT 01/03/2031', amount: -52_557.07, patrimony: { quantity: 2.89, unitValue: 18_185.84 } },
    { date: '2026-01-28', description: 'LIQ BOLSA (OPERACOES)- PREGAO:27/01/2026', amount: 1_997.32 },
    { date: '2026-01-30', description: 'LIQ BOLSA (OPERACOES)- PREGAO:29/01/2026', amount: 1_597.86 },
  ];

  for (const [index, row] of rows.entries()) {
    const eventId = randomUUID();
    const sourceRef = `BTG-EXT-${MONTH}-${String(index + 1).padStart(3, '0')}`;
    await conn.query(
      `INSERT INTO business_events
        (id, organization_id, source_module, event_kind, occurred_on, settles_on,
         source_ref, counterparty, total_net, source_system, source_version, metadata)
       VALUES (?, ?, 'INVEST', 'cash_movement', ?, ?, ?, 'BTG Pactual', ?, 'btg_manual_extract_jan2026', '1', JSON_OBJECT('description', ?))`,
      [eventId, ORG, row.date, row.date, sourceRef, row.amount, row.description]
    );
    await conn.query(
      `INSERT INTO financial_ledger_entries
        (id, organization_id, account_id, transaction_date, settlement_date, direction,
         amount, currency, description, counterparty, status, business_event_id,
         external_ref, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL', ?, 'BTG Pactual', 'cleared', ?, ?, JSON_OBJECT('broker_note_ref', ?, 'legacy_op', ?))`,
      [
        randomUUID(),
        ORG,
        accountId,
        row.date,
        row.date,
        row.amount >= 0 ? 'in' : 'out',
        Math.abs(row.amount),
        row.description,
        eventId,
        sourceRef,
        sourceRef,
        row.amount >= 0 ? 'cash_yield' : 'fee',
      ]
    );
    if (row.patrimony) {
      const [lftItems] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT id FROM patrimony_items
          WHERE organization_id = ? AND identifier = 'LFT-20310301' AND deleted_at IS NULL
          LIMIT 1`,
        [ORG]
      );
      const lftItemId = String(lftItems[0]?.id || '');
      if (!lftItemId) throw new Error('Item LFT-20310301 nao encontrado.');
      await conn.query(
        `INSERT INTO patrimony_ledger_entries
          (id, organization_id, patrimony_item_id, transaction_date, movement_type,
           quantity_delta, unit_value, total_value, impacts_valuation,
           external_ref, notes, business_event_id, metadata)
         VALUES (?, ?, ?, ?, 'acquisition', ?, ?, ?, TRUE, ?, ?, ?, JSON_OBJECT('legacy_op', 'buy', 'broker_note_ref', ?, 'source', 'btg_monthly_extract'))`,
        [
          randomUUID(),
          ORG,
          lftItemId,
          row.date,
          row.patrimony.quantity,
          row.patrimony.unitValue,
          Math.round(row.patrimony.quantity * row.patrimony.unitValue * 100) / 100,
          `${sourceRef}:LFT`,
          row.description,
          eventId,
          `${sourceRef}:LFT`,
        ]
      );
    }
  }

  await conn.query(
    `UPDATE patrimony_items pi
       INNER JOIN (
         SELECT patrimony_item_id,
                SUM(quantity_delta) AS quantity,
                SUM(total_value) AS acquisition_value
           FROM patrimony_ledger_entries
          WHERE organization_id = ? AND deleted_at IS NULL
          GROUP BY patrimony_item_id
       ) agg ON agg.patrimony_item_id = pi.id
       SET pi.quantity = agg.quantity,
           pi.acquisition_value = agg.acquisition_value,
           pi.current_value = agg.acquisition_value
     WHERE pi.organization_id = ? AND pi.deleted_at IS NULL`,
    [ORG, ORG]
  );

  return {
    inserted: rows.length,
    net: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
  };
}

async function validate(pool: mysql.Pool, applyResult: Record<string, unknown>) {
  const conn = await pool.getConnection();
  try {
    const [cashRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance
         FROM financial_ledger_entries
        WHERE organization_id = ?
          AND transaction_date <= ?
          AND status <> 'cancelled'
          AND deleted_at IS NULL`,
      [ORG, CLOSING_DATE]
    );
    const cash = Math.round(Number(cashRows[0]?.balance ?? 0) * 100) / 100;

    const [items] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT identifier, subcategory, CAST(quantity AS DECIMAL(18,6)) AS quantity,
              CAST(current_value AS DECIMAL(18,4)) AS current_value
         FROM patrimony_items
        WHERE organization_id = ? AND deleted_at IS NULL
        ORDER BY identifier`,
      [ORG]
    );

    const currentByTicker = new Map<string, number>();
    for (const item of items) currentByTicker.set(String(item.identifier), Number(item.current_value ?? 0));
    const portfolio = Math.round(
      [...currentByTicker.entries()]
        .filter(([ticker]) => ticker !== 'PRIO3')
        .reduce((sum, [, value]) => sum + value, 0) * 100
    ) / 100;
    const patrimony = Math.round((cash + portfolio) * 100) / 100;

    const [orphans] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
          (SELECT COUNT(*) FROM patrimony_ledger_entries
            WHERE organization_id = ? AND deleted_at IS NULL AND business_event_id IS NULL) AS patrimony_orphans,
          (SELECT COUNT(*) FROM financial_ledger_entries
            WHERE organization_id = ? AND deleted_at IS NULL AND business_event_id IS NULL) AS financial_orphans`,
      [ORG, ORG]
    );

    const storage = await StorageMeter.recalculateOrganizationUsage(conn, ORG);
    const diffCash = Math.round((cash - TARGETS.closingCash) * 100) / 100;
    const diffPatrimony = Math.round((patrimony - TARGETS.closingNetPatrimony) * 100) / 100;

    return {
      applyResult: {
        ...applyResult,
      },
      cash,
      targetCash: TARGETS.closingCash,
      diffCash,
      portfolio,
      patrimony,
      targetPatrimony: TARGETS.closingNetPatrimony,
      diffPatrimony,
      orphans: orphans[0],
      storage,
      items,
      ok: Math.abs(diffCash) <= 0.01 && Math.abs(diffPatrimony) <= 0.01,
    };
  } finally {
    conn.release();
  }
}

async function main() {
  process.env.REMOTE_DB_NAME = process.env.REMOTE_DB_NAME || 'co_ceo_db';
  const { base, notesDir, extract } = monthPaths();

  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
    port: Number(process.env.REMOTE_DB_PORT || process.env.DB_PORT || 3306),
    user: process.env.REMOTE_DB_USER || process.env.DB_USER,
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
    timezone: '+00:00',
  });

  try {
    const conn = await pool.getConnection();
    try {
      const purge = await purgeHolding(conn);
      console.log('purge=', purge);
    } finally {
      conn.release();
    }

    const opening = await recordCorrectOpening(pool);
    console.log('opening=', opening);

    const openingRefConn = await pool.getConnection();
    try {
      await ensureOpeningCashReference(openingRefConn);
    } finally {
      openingRefConn.release();
    }

    const gateway = new CoCeoDataGateway(pool);
    const ledger = new LedgerImportService(gateway);
    const ctx: UserContext = {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId: ORG,
      impersonatorId: null,
      scope: 'global',
    };

    const noteFiles = listNotePdfs(notesDir).map((p) => toUpload(p, notesDir));
    const notesApply = await applyBtgBrokerageUpload(ctx, ledger, noteFiles);

    const cashConn = await pool.getConnection();
    let cashApply: { inserted: number; net: number };
    try {
      cashApply = await importManualCashExtract(cashConn);
      await applyClosingMarks(cashConn);
    } finally {
      cashConn.release();
    }
    void extract;
    void base;

    const report = await validate(pool, {
      notesInserted: notesApply.totals.inserted,
      notesSkipped: notesApply.totals.skipped,
      notesEnriched: notesApply.totals.enriched,
      manualCashInserted: cashApply.inserted,
      manualCashNet: cashApply.net,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
