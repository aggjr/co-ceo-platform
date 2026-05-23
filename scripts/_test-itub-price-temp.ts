import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import type { LedgerEvent } from '../src/core/invest/CustodyEngine';

function ev(
  ticker: string,
  type: string,
  qty: number,
  price: number,
  net: number,
  date: string,
  ref?: string,
  notes?: string
): LedgerEvent {
  const isOpt = /^ITUB[A-Z]/.test(ticker) && ticker !== 'ITUB4';
  return {
    id: `${ticker}-${date}-${type}`,
    asset_id: ticker,
    asset_ticker: ticker,
    asset_type: isOpt ? 'option_put' : 'stock',
    underlying_ticker: 'ITUB4',
    transaction_type: type,
    transaction_date: date,
    quantity: qty,
    unit_price: price,
    total_net_value: net,
    broker_note_ref: ref ?? null,
    notes: notes ?? null,
  };
}

const minimal = [
  ev('ITUBQ413', 'put_sell', -1200, 0.31, 377, '2026-04-29'),
  ev(
    'ITUB4',
    'buy',
    1200,
    41.43,
    -49716,
    '2026-05-15',
    'BTG-EXERCISE-2026-05-15#8#ITUBQ413F',
    'Exercício — ITUBQ413F'
  ),
];
console.log('minimal', computeThreePricesByUnderlying(minimal).get('ITUB4'));

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';

dotenv.config();

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: 'org-holding-001', scope: 'node' as const };
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const itub = events.filter(
    (e) =>
      e.asset_ticker === 'ITUB4' ||
      e.underlying_ticker === 'ITUB4' ||
      String(e.asset_ticker).startsWith('ITUB')
  );
  const p = computeThreePricesByUnderlying(itub).get('ITUB4');
  console.log('full itub events', itub.length, p);
  await pool.end();
})();
