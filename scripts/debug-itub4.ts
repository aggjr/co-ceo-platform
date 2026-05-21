import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

dotenv.config();

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.id, e.transaction_date, e.transaction_type, e.quantity, e.unit_price,
            e.total_net_value, e.impacts_managerial_price, a.asset_ticker, a.asset_type,
            a.id AS asset_id, e.underlying_ticker, e.broker_note_ref
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = 'org-holding-001' AND e.deleted_at IS NULL
     ORDER BY e.transaction_date, e.id`
  );
  const events: LedgerEvent[] = rows.map((r) => ({
    id: String(r.id),
    transaction_date:
      r.transaction_date instanceof Date
        ? r.transaction_date.toISOString().slice(0, 10)
        : String(r.transaction_date).slice(0, 10),
    asset_id: String(r.asset_id),
    asset_ticker: String(r.asset_ticker),
    asset_type: String(r.asset_type),
    underlying_ticker: r.underlying_ticker ? String(r.underlying_ticker) : undefined,
    transaction_type: String(r.transaction_type),
    quantity: Number(r.quantity),
    unit_price: Number(r.unit_price),
    total_net_value: Number(r.total_net_value),
    impacts_managerial_price: r.impacts_managerial_price == null ? true : !!r.impacts_managerial_price,
    brokerage_fee: 0,
    b3_fees: 0,
    irrf_tax: 0,
  }));

  const exItub = events.filter(
    (e) => e.asset_ticker.startsWith('ITUBQ') && e.transaction_type === 'option_exercise'
  );
  console.log('Exercises ITUB:', exItub.length);
  console.log('Sample exercise:', JSON.stringify(exItub[0], null, 2));

  const map = computeThreePricesByUnderlying(events);
  const p = map.get('ITUB4');
  console.log('ITUB4 prices:', p);

  // Recalcular manualmente: b3 esperado
  const itubBuys = events.filter(
    (e) => e.asset_ticker === 'ITUB4' && e.transaction_type === 'buy'
  );
  const itubSells = events.filter(
    (e) => e.asset_ticker === 'ITUB4' && e.transaction_type === 'sell'
  );
  let totalBuyCost = 0;
  for (const b of itubBuys) totalBuyCost += -Number(b.total_net_value);
  let totalSellQty = 0;
  for (const s of itubSells) totalSellQty += Math.abs(Number(s.quantity));
  const totalBuyQty = itubBuys.reduce((s, b) => s + Math.abs(Number(b.quantity)), 0);
  const remainQty = totalBuyQty - totalSellQty;
  const remainCost = totalBuyCost * (remainQty / totalBuyQty);
  const sumPremioExercises = exItub.reduce((s, e) => s + Math.abs(Number(e.total_net_value)), 0);
  console.log('Esperado:');
  console.log('  totalBuyQty', totalBuyQty, 'totalSellQty', totalSellQty, 'remainQty', remainQty);
  console.log('  totalBuyCost', totalBuyCost.toFixed(2), 'remainCost', remainCost.toFixed(2));
  console.log('  sumPremioExercises', sumPremioExercises.toFixed(2));
  console.log('  PM Estrito esperado =', (remainCost / remainQty).toFixed(4));
  console.log('  PM B3 esperado     =', ((remainCost - sumPremioExercises) / remainQty).toFixed(4));

  await pool.end();
})();
