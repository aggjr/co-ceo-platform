/**
 * Repara livro razão de ITUB4/BBAS3/WEGE3/PRIO3:
 * 1) Remove ajustes sintéticos BTG-SNAPSHOT-STOCK-SYNC
 * 2) Remove exercícios BTG 15/05
 * 3) Remove notas B3_* (myProfit legado) — reimporta só BTG home broker
 * 4) Reimporta btg-orders + exercícios BTG
 *
 * Uso: npx ts-node scripts/repair-equity-ledger-augusto.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { mapBrokerOrderToLedger } from '../src/core/invest/brokerOrderMapper';
import { normalizeBtgOrdersPayload } from '../src/core/invest/btgHomeBrokerImport';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';
import { buildThreeAvgPricesByUnderlying } from '../src/core/invest/portfolioThreePrices';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const BATCH_PREFIX = 'BTG-EXERCISE-2026-05-15';
const OPENING_REF = 'OPENING-BTG-2026-01-01';
const LEGACY_OPENING_REF = 'OPENING-MYPROFIT-2025-12-31';
const TICKERS = ['ITUB4', 'BBAS3', 'WEGE3', 'PRIO3'];

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  const del = async (sql: string, params: unknown[]) => {
    const [r] = await pool.query(sql, params);
    return (r as { affectedRows: number }).affectedRows;
  };

  const n1 = await del(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ? AND broker_note_ref LIKE 'BTG-SNAPSHOT-STOCK-SYNC%'`,
    [ORG_ID]
  );
  console.log('Removidos BTG-SNAPSHOT-STOCK-SYNC:', n1);

  const n2 = await del(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ? AND broker_note_ref LIKE 'BTG-EXERCISE-2026-05-15%'`,
    [ORG_ID]
  );
  console.log('Removidos BTG-EXERCISE-2026-05-15:', n2);

  const n3 = await del(
    `DELETE FROM invest_ledger_entries
     WHERE organization_id = ?
       AND broker_note_ref LIKE 'B3_%'
       AND broker_note_ref NOT IN (?, ?)`,
    [ORG_ID, OPENING_REF, LEGACY_OPENING_REF]
  );
  console.log('Removidos B3_* (ordens myProfit legado):', n3);

  const ordersPath = path.join(
    __dirname,
    '..',
    'data',
    'invest',
    'btg-orders-augusto-h1-2026.json'
  );
  if (!fs.existsSync(ordersPath)) {
    console.error('Gere antes: npx ts-node scripts/build-btg-orders-import.ts');
    process.exit(1);
  }
  const ordersRaw = JSON.parse(fs.readFileSync(ordersPath, 'utf8')) as {
    entries?: LedgerImportLine[];
  };
  const orders = normalizeBtgOrdersPayload(ordersRaw.entries || []);
  const ordersResult = await ledger.importEntriesOnly(ctx, orders, {
    sourceLabel: 'BTG Pactual home broker jan–mai/2026 (reparo)',
  });
  console.log('Reimport BTG ordens:', ordersResult);

  const exPath = path.join(__dirname, '..', 'data', 'invest', 'btg-exercises-2026-05-15.json');
  const exData = JSON.parse(fs.readFileSync(exPath, 'utf8')) as {
    exercise_date: string;
    orders: Array<{
      ticker: string;
      direction: 'C' | 'V';
      quantity: number;
      avgPrice: number;
      date?: string;
    }>;
  };
  const exLines: LedgerImportLine[] = [];
  let seq = 0;
  for (const o of exData.orders) {
    seq += 1;
    const orderDate = o.date || exData.exercise_date;
    exLines.push(
      ...mapBrokerOrderToLedger({
        ticker: o.ticker,
        direction: o.direction,
        quantity: o.quantity,
        avgPrice: o.avgPrice,
        date: orderDate,
        broker_note_ref: `${BATCH_PREFIX}#${seq}#${o.ticker}`,
      })
    );
  }
  const exResult = await ledger.importEntriesOnly(ctx, exLines, {
    sourceLabel: 'BTG exercícios 15/05/2026 (reparo)',
  });
  console.log('Reimport exercícios:', exResult);

  const openingPath = path.join(
    __dirname,
    '..',
    'data',
    'invest',
    'opening-btg-2026-01-01.json'
  );
  const opening = JSON.parse(fs.readFileSync(openingPath, 'utf8')) as {
    opening_positions?: Array<{ ticker: string; quantity: number; avg_price: number }>;
  };
  for (const pos of opening.opening_positions || []) {
    const ticker = pos.ticker.toUpperCase();
    const qty = Math.abs(Number(pos.quantity));
    const price = Number(pos.avg_price);
    const gross = Math.round(qty * price * 100) / 100;
    for (const ref of [OPENING_REF, LEGACY_OPENING_REF]) {
      const [upd] = await pool.query(
        `UPDATE invest_ledger_entries e
         JOIN invest_assets a ON a.id = e.asset_id
         SET e.quantity = ?, e.unit_price = ?, e.total_gross_value = ?, e.total_net_value = ?,
             e.broker_note_ref = ?
         WHERE e.organization_id = ?
           AND e.broker_note_ref = ?
           AND a.asset_ticker = ?
           AND e.transaction_type = 'opening_balance'
           AND e.deleted_at IS NULL`,
        [qty, price, gross, -gross, OPENING_REF, ORG_ID, ref, ticker]
      );
      if ((upd as { affectedRows: number }).affectedRows > 0) {
        console.log(`Abertura ${ticker}: ${qty} @ ${price} (ref ${OPENING_REF})`);
        break;
      }
    }
  }

  await ledger.reconcileCustody(ctx);

  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const three = buildThreeAvgPricesByUnderlying(events);
  const { assets } = rebuildCustodyFromLedger(events);

  console.log('\n=== Três preços ===');
  for (const t of TICKERS) {
    console.log(t, three.get(t));
  }

  console.log('\n=== Custódia (replay) ===');
  for (const t of TICKERS) {
    const hit = assets.find((a) => a.ticker.toUpperCase() === t);
    console.log(t, hit ? { qty: hit.quantity, avg: hit.avgPrice } : '—');
  }

  const [itub3] = await pool.query(
    `SELECT COUNT(1) AS n FROM invest_ledger_entries
     WHERE organization_id = ? AND underlying_ticker = 'ITUB3'`,
    [ORG_ID]
  );
  console.log('\nLançamentos com underlying ITUB3:', (itub3 as { n: number }[])[0]?.n);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
