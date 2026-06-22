import dotenv from 'dotenv';
dotenv.config();
import { createInvestPool } from './lib/invest-db-pool';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';
import { MYPROFIT_LFT_TRADES, myProfitLftNetQty } from '../tests/fixtures/myprofit-lft-20310301';

async function main() {
  const pool = createInvestPool();
  const gw = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: 'org-holding-001', scope: 'node' as const };
  const ledger = new LedgerImportService(gw);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2026-06-22');
  const lft = events
    .filter((e) => String(e.asset_ticker || '').includes('LFT'))
    .filter((e) => ['buy', 'sell', 'opening_balance'].includes(String(e.transaction_type)))
    .sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)));

  console.log('=== LFT vs MyProfit ===');
  const byDate = new Map<string, typeof lft>();
  for (const e of lft) {
    const d = String(e.transaction_date).slice(0, 10);
    byDate.set(d, [...(byDate.get(d) || []), e]);
  }

  for (const ref of MYPROFIT_LFT_TRADES) {
    const rows = (byDate.get(ref.date) || []).filter((e) =>
      ref.side === 'buy' ? String(e.transaction_type) === 'buy' : String(e.transaction_type) === 'sell'
    );
    const qtySum =
      ref.side === 'buy'
        ? rows.reduce((s, e) => s + Number(e.quantity), 0)
        : rows.reduce((s, e) => s + Math.abs(Number(e.quantity)), 0);
    const ok = Math.abs(qtySum - ref.quantity) < 0.02;
    console.log(
      `${ok ? 'OK' : 'XX'} ${ref.date} ${ref.side} ref=${ref.quantity} livro=${qtySum.toFixed(4)}`
    );
  }

  const { assets } = rebuildCustodyFromLedger(events);
  const c = assets.find((a) => a.ticker.includes('LFT'));
  console.log(`\nCustodia: ${c?.quantity} | MyProfit esperado: ${myProfitLftNetQty()}`);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
