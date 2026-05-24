/**
 * Pente fino: decomposição patrimonial vs âncora BTG (ações, opções, caixa, RF, pendências).
 *
 *   npx ts-node scripts/diagnose-patrimony-components.ts
 *   PATRIMONY_TO=2026-05-22 npx ts-node scripts/diagnose-patrimony-components.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { PatrimonyMonthlyAnchorsRepository } from '../src/core/invest/PatrimonyMonthlyAnchorsRepository';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';
import { InvestAssetProjection } from '../src/modules/invest/sync/InvestAssetProjection';
import {
  fixedIncomeTotalFromLedger,
  shouldUseBtgAnchorCalibration,
} from '../src/core/invest/patrimonyLedgerGates';
import { interpolatePatrimonyTarget } from '../src/core/invest/patrimonyAnchors';
import { inferAssetType, inferUnderlyingTicker } from '../src/core/invest/assetClassifier';
import { isOptionTicker } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const TO = process.env.PATRIMONY_TO || '2026-05-23';
const FROM = process.env.PATRIMONY_FROM || '2025-12-31';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(n: number, base: number): string {
  if (!base) return '—';
  return `${((n / base) * 100).toFixed(1)}%`;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  const anchors = await anchorsRepo.loadForOrganization(ctx);
  const events = await ledger.listLedgerEvents(ctx, FROM, TO);
  const projection = new InvestAssetProjection(gateway);
  const assets = await projection.listActiveAssets(ctx);
  const recorder = new PatrimonyDailyRecorder(gateway);
  const { quotes: stockQuotes } = await recorder.loadStockQuotes(ctx, TO);
  const marketQuotes = new MarketQuoteRepository(gateway);
  const quoteMap = await marketQuotes.loadQuoteMapForRange(ctx, TO, TO);
  const quoteForDate = marketQuotes.buildQuoteForDateFn(quoteMap);

  const rfLedger = fixedIncomeTotalFromLedger(events);
  const rfAnchor = Number(anchors.fixed_income_total ?? 0);

  const economic = buildDailyPatrimonyMtmSeries(events, FROM, TO, {
    anchors,
    stockQuotes,
    quoteForDate,
    fixedIncomeTotal: rfLedger,
    calibrateToAnchors: false,
  });
  const calibrated = buildDailyPatrimonyMtmSeries(events, FROM, TO, {
    anchors,
    stockQuotes,
    quoteForDate,
    fixedIncomeTotal: rfAnchor,
    calibrateToAnchors: shouldUseBtgAnchorCalibration(events) && anchors.month_ends.length > 0,
  });

  const ecoDay = economic.series.find((p) => p.date === TO);
  const calDay = calibrated.series.find((p) => p.date === TO);
  const btgTarget = interpolatePatrimonyTarget(TO, anchors);

  const [[stored]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT patrimony, patrimony_gross, cash, positions_value, fixed_income_total, pending_settlements
     FROM invest_portfolio_daily WHERE organization_id = ? AND snapshot_date = ?`,
    [ORG, TO]
  );

  console.log('=== Pente fino patrimônio ===');
  console.log('Org:', ORG, '| Data:', TO);
  console.log('Âncora BTG (interpolação):', brl(btgTarget));
  console.log('');

  console.log('--- Totais ---');
  console.log('Motor econômico (livro×cotação):', brl(ecoDay?.patrimony ?? 0));
  console.log('Motor calibrado BTG:          ', brl(calDay?.patrimony ?? 0));
  console.log('Gravado invest_portfolio_daily:', stored ? brl(Number(stored.patrimony)) : '(sem linha)');
  console.log(
    'Δ econômico vs BTG:           ',
    brl(Math.round(((ecoDay?.patrimony ?? 0) - btgTarget) * 100) / 100)
  );
  console.log('');

  if (stored) {
    console.log('--- Decomposição gravada (DB) ---');
    const cash = Number(stored.cash);
    const pos = Number(stored.positions_value);
    const rf = Number(stored.fixed_income_total);
    const pend = Number(stored.pending_settlements);
    const pat = Number(stored.patrimony);
    console.log('  Caixa:              ', brl(cash), pct(cash, pat));
    console.log('  Posições (RV+opções):', brl(pos), pct(pos, pat));
    console.log('  Renda fixa:         ', brl(rf), pct(rf, pat));
    console.log('  Pendências:         ', brl(pend), pct(pend, pat));
    console.log('  Soma:               ', brl(cash + pos + rf + pend));
    console.log('');
  }

  console.log('--- RF ---');
  console.log('  Total livro (motor econômico):', brl(rfLedger));
  console.log('  Total âncora BTG:             ', brl(rfAnchor));
  console.log('  Δ:                            ', brl(rfLedger - rfAnchor));
  console.log('');

  // Custódia canônica (patrimony_items.current_value)
  let custodyStock = 0;
  let custodyOption = 0;
  let custodyCash = 0;
  let custodyOther = 0;
  let custodyTotal = 0;
  const optionRows: Array<{
    ticker: string;
    qty: number;
    curVal: number;
    lastPrice: number;
    markSource: string;
    engineMark: number;
  }> = [];

  for (const a of assets) {
    const ticker = a.asset_ticker;
    const type = a.asset_type;
    const qty = Number(a.current_quantity);
    const curVal = Number(a.current_value ?? 0);
    custodyTotal += curVal;

    let meta: Record<string, unknown> = {};
    if (a.metadata) {
      try {
        meta = JSON.parse(a.metadata) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    const lastPrice = Number(meta.last_price ?? 0);
    const dailyQ = quoteForDate(ticker, TO);
    const mark = dailyQ ?? stockQuotes[ticker] ?? lastPrice;
    const engineMark = Math.abs(qty) > 1e-6 ? qty * (Number.isFinite(mark) ? mark : a.managerial_avg_price) : 0;

    if (type === 'cash' || ticker.startsWith('CAIXA-')) {
      custodyCash += curVal;
      continue;
    }
    if (type === 'stock' || type === 'fii') {
      custodyStock += curVal;
      continue;
    }
    if (type === 'option_call' || type === 'option_put' || isOptionTicker(ticker)) {
      custodyOption += curVal;
      const src = dailyQ != null ? 'market_quotes_daily' : stockQuotes[ticker] != null ? 'last_quote_sync' : lastPrice > 0 ? 'metadata' : 'sem_cotação';
      if (Math.abs(qty) > 0.01) {
        optionRows.push({ ticker, qty, curVal, lastPrice, markSource: src, engineMark });
      }
      continue;
    }
    custodyOther += curVal;
  }

  console.log('--- Custódia (patrimony_items.current_value) ---');
  console.log('  Ações/FII:  ', brl(custodyStock));
  console.log('  Opções:     ', brl(custodyOption));
  console.log('  Caixa:      ', brl(custodyCash));
  console.log('  Outros:     ', brl(custodyOther));
  console.log('  Total:      ', brl(custodyTotal));
  console.log('  (+ RF âncora se não está em items):', brl(rfAnchor));
  console.log('  Total aprox. + RF:                  ', brl(custodyTotal + rfAnchor));
  console.log('');

  optionRows.sort((a, b) => Math.abs(b.curVal) - Math.abs(a.curVal));
  console.log('--- Top 15 opções (custódia vs mark motor) ---');
  console.log('Ticker          | Qtd      | current_value | mark×qty motor | fonte mark');
  for (const r of optionRows.slice(0, 15)) {
    console.log(
      `${r.ticker.padEnd(15)} | ${String(r.qty).padStart(8)} | ${brl(r.curVal).padStart(13)} | ${brl(r.engineMark).padStart(14)} | ${r.markSource}`
    );
  }
  const optEngineSum = optionRows.reduce((s, r) => s + r.engineMark, 0);
  const optNoQuote = optionRows.filter((r) => r.markSource === 'sem_cotação');
  console.log('');
  console.log('Soma mark×qty opções (motor):', brl(optEngineSum));
  console.log('Soma current_value opções:   ', brl(custodyOption));
  console.log('Opções sem cotação de mercado:', optNoQuote.length, '/', optionRows.length);
  console.log('');

  const stockAssets = assets.filter(
    (a) => (a.asset_type === 'stock' || a.asset_type === 'fii') && Math.abs(a.current_quantity) > 0
  );
  console.log('--- Ações/FII (amostra) ---');
  for (const a of stockAssets.slice(0, 10)) {
    const q = Number(a.current_quantity);
    const mq = quoteForDate(a.asset_ticker, TO) ?? stockQuotes[a.asset_ticker];
    const mtm = q * (mq ?? a.managerial_avg_price);
    console.log(
      `  ${a.asset_ticker}: qty=${q} mark=${mq ?? 'PM'} → ${brl(mtm)} | current_value=${brl(Number(a.current_value))}`
    );
  }
  console.log('');

  const cashAccounts = assets.filter((a) => a.asset_ticker.startsWith('CAIXA-'));
  console.log('--- Contas de caixa ---');
  for (const c of cashAccounts) {
    console.log(`  ${c.asset_ticker}: saldo=${brl(Number(c.current_quantity))} current_value=${brl(Number(c.current_value))}`);
  }

  // Cash no motor vs contas
  console.log('');
  console.log('Caixa motor (livro replay):', brl(ecoDay?.cash ?? 0));
  console.log('Caixa custody (soma CAIXA-*):', brl(custodyCash));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
