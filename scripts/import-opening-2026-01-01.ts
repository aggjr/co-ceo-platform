/**
 * Insere o saldo inicial em 01/01/2026 da carteira da holding (org-holding-001)
 * direto no servidor de produção via gateway de dados (CoCeoDataGateway).
 *
 * Fonte: posicao homebroker + B3 em 31/12/2025 (carteira do titular da holding).
 * Patrimônio alvo: R$ 1.212.435,41 (longos R$ 1.266.082,44 + shorts -R$ 53.647,02).
 *
 * Idempotência: `LedgerImportService.importOpeningOnly` checa por
 * `broker_note_ref = 'OPENING-BTG-2026-01-01'` por ticker + tipo. Rodar de
 * novo apenas pula linhas já existentes.
 *
 * Uso (PowerShell):
 *   $env:REMOTE_DB_HOST="69.62.99.34"; $env:REMOTE_DB_PASSWORD="..."
 *   npx ts-node scripts/import-opening-2026-01-01.ts
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import {
  CoCeoDataGateway,
  SYSTEM_INSTALLER_USER_ID,
  type UserContext,
} from '../src/core/dal';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { OpeningImportPayload } from '../src/core/invest/ledgerTypes';

const HOLDING_ORG_ID = 'org-holding-001';
const HOLDING_OWNER_EMAIL = 'augustoggomes@yahoo.com.br';
const OPENING_DATE = '2026-01-01';

const PAYLOAD: OpeningImportPayload = {
  opening_date: OPENING_DATE,
  source_label: 'Homebroker BTG + posição B3 em 31/12/2025',
  opening_positions: [
    {
      ticker: 'PRIO3',
      asset_type: 'stock',
      quantity: 5_400,
      avg_price: 38.33,
      notes: 'PetroRio (ação ordinária)',
    },
    {
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      quantity: 1,
      avg_price: 58_758.79,
      notes: 'Saldo em conta investimento BTG em 01/01/2026',
    },
    {
      ticker: 'LFT-20310301',
      asset_type: 'fixed_income',
      quantity: 1,
      avg_price: 1_000_341.65,
      notes: 'Tesouro LFT 01/03/2031 (custódia BTG) — quantity=1, unit_price=valor financeiro',
    },
  ],
  opening_short_options: [
    {
      ticker: 'PRIOQ43',
      operation: 'put_sell',
      quantity: 31_200,
      unit_price: 1.426748,
      underlying_ticker: 'PRIO3',
      notes: 'PUT vendida — prêmio recebido por ação',
    },
    {
      ticker: 'PRIOR407',
      operation: 'put_sell',
      quantity: 6_300,
      unit_price: 0.912254,
      underlying_ticker: 'PRIO3',
      notes: 'PUT vendida — prêmio recebido por ação',
    },
    {
      ticker: 'PRIOA407',
      operation: 'call_sell',
      quantity: 5_400,
      unit_price: 0.626905,
      underlying_ticker: 'PRIO3',
      notes: 'CALL vendida — prêmio recebido por ação',
    },
  ],
};

async function run() {
  const host = process.env.REMOTE_DB_HOST || process.env.DB_HOST;
  const password = process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD;
  const user = process.env.REMOTE_DB_USER || process.env.DB_USER || 'root';
  const database = process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform';
  if (!host || !password) {
    console.error('Defina REMOTE_DB_HOST e REMOTE_DB_PASSWORD.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 4,
    charset: 'utf8mb4',
  });

  try {
    const [orgs] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM organizations WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [HOLDING_ORG_ID]
    );
    if (!orgs.length) {
      throw new Error(`Organização ${HOLDING_ORG_ID} não encontrada.`);
    }

    // Abertura inicial = bootstrap administrativo (mesmo padrão dos seeds).
    // Auditoria registra SYSTEM_INSTALLER; organization_id sai correto no livro razão.
    const ctx: UserContext = {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId: HOLDING_ORG_ID,
      impersonatorId: null,
      scope: 'global',
    };

    const gateway = new CoCeoDataGateway(pool);
    const ledger = new LedgerImportService(gateway);

    console.log(`Inserindo abertura ${OPENING_DATE} para ${HOLDING_ORG_ID} (titular da holding: ${HOLDING_OWNER_EMAIL}; autor técnico: SYSTEM_INSTALLER)…`);
    const result = await ledger.importOpeningOnly(ctx, PAYLOAD);
    console.log('Resumo:', {
      batchId: result.batchId,
      inserted: result.inserted,
      skipped: result.skipped,
      openingDate: result.openingDate,
    });

    console.log('\nPosições resultantes em patrimony_items:');
    const [items] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT identifier, subcategory,
              CAST(quantity AS CHAR) qty,
              CAST(acquisition_value AS CHAR) acq,
              status
       FROM patrimony_items
       WHERE organization_id = ? AND deleted_at IS NULL
       ORDER BY subcategory, identifier`,
      [HOLDING_ORG_ID]
    );
    for (const it of items) {
      console.log(
        `  ${String(it.identifier).padEnd(20)} ${String(it.subcategory).padEnd(14)} qty=${it.qty}  acq=${it.acq}  status=${it.status}`
      );
    }

    console.log('\nLançamentos OPENING (patrimony_ledger_entries):');
    const [entries] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT i.identifier, e.movement_type,
              CAST(e.quantity_delta AS CHAR) qty,
              CAST(e.unit_value AS CHAR) pu,
              CAST(e.total_value AS CHAR) total
       FROM patrimony_ledger_entries e
       JOIN patrimony_items i ON i.id = e.patrimony_item_id
       WHERE e.organization_id = ? AND e.transaction_date = ?
         AND e.movement_type = 'opening_balance'
         AND e.deleted_at IS NULL
       ORDER BY i.identifier`,
      [HOLDING_ORG_ID, OPENING_DATE]
    );
    let totalLong = 0;
    let totalShort = 0;
    for (const e of entries) {
      const total = Number(e.total);
      const isShort = Number(e.qty) < 0;
      if (isShort) totalShort += total;
      else totalLong += total;
      console.log(
        `  ${String(e.identifier).padEnd(20)} ${String(e.movement_type).padEnd(18)} qty=${e.qty}  pu=${e.pu}  total=${total.toFixed(4)}`
      );
    }
    const patrimony = totalLong - totalShort;
    console.log(`\nLongos:     R$ ${totalLong.toFixed(2)}`);
    console.log(`Shorts:    -R$ ${Math.abs(totalShort).toFixed(2)}`);
    console.log(`Patrimônio (longos - |shorts|): R$ ${(totalLong - Math.abs(totalShort)).toFixed(2)}`);
    console.log(`Alvo informado:                 R$ 1212435.41`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
