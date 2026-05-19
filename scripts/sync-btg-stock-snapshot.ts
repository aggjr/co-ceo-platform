/**
 * Completa ações que existem no snapshot BTG mas não aparecem no myProfit (ex.: BBAS3, ITUB4, WEGE3).
 * Cria compras de ajuste na data do snapshot para bater quantidade.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const SYNC_REF = 'BTG-SNAPSHOT-STOCK-SYNC';

type Snapshot = {
  as_of: string;
  renda_variavel?: { acoes?: { items?: Array<{ ticker: string; quantity: number; avg_price: number }> } };
};

async function main() {
  const snapPath = path.join(__dirname, '..', 'data', 'invest', 'snapshot-btg-quotes-current.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as Snapshot;
  const targets = snap.renda_variavel?.acoes?.items || [];
  const asOf = snap.as_of || '2026-05-18';

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const [current] = await pool.query(
    `SELECT asset_ticker, current_quantity
     FROM invest_assets WHERE organization_id = ? AND status = 'active'`,
    [ORG_ID]
  );
  const qtyMap = new Map(
    (current as { asset_ticker: string; current_quantity: string }[]).map((r) => [
      r.asset_ticker,
      Number(r.current_quantity),
    ])
  );

  const entries: LedgerImportLine[] = [];
  for (const t of targets) {
    const ticker = t.ticker.toUpperCase();
    const targetQty = Number(t.quantity);
    const have = qtyMap.get(ticker) || 0;
    const delta = Math.round((targetQty - have) * 10000) / 10000;
    if (Math.abs(delta) < 0.0001) {
      console.log(`OK ${ticker}: ${have}`);
      continue;
    }
    const isBuy = delta > 0;
    const qty = Math.abs(delta);
    const price = Number(t.avg_price);
    entries.push({
      date: asOf,
      ticker,
      asset_type: 'stock',
      underlying_ticker: ticker,
      operation: isBuy ? 'buy' : 'sell',
      quantity: qty,
      unit_price: price,
      total_net_value: isBuy ? -(qty * price) : qty * price,
      broker_note_ref: `${SYNC_REF}:${ticker}`,
      notes: `Ajuste custódia → snapshot BTG (${have} → ${targetQty})`,
      impacts_managerial_price: true,
    });
    console.log(`Ajuste ${ticker}: ${have} → ${targetQty} (${isBuy ? 'buy' : 'sell'} ${qty})`);
  }

  if (!entries.length) {
    console.log('Nada a ajustar.');
    await pool.end();
    return;
  }

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };
  const result = await ledger.importEntriesOnly(ctx, entries, {
    sourceLabel: 'Snapshot BTG ações',
  });
  console.log('Import:', JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
