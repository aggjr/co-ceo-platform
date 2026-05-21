/**
 * Diagnóstico de uma ação: livro razão + opções do underlying + custódia
 * recalculada + 3 preços + snapshot atual, lado a lado.
 *
 * Uso: npx ts-node scripts/inspect-ticker.ts ITUB4
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { rebuildCustodyFromLedger, type LedgerEvent } from '../src/core/invest/CustodyEngine';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import { inferUnderlyingTicker, isOptionTicker } from '../src/core/invest/assetClassifier';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const ticker = (process.argv[2] || 'ITUB4').toUpperCase();

function fmtBrl(n: number): string {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtNum(n: number, digits = 4): string {
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

async function main(): Promise<void> {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  // 1. Todos os lançamentos do livro razão na organização.
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.id, e.transaction_date, e.transaction_type, e.quantity, e.unit_price,
            e.total_net_value, e.brokerage_fee, e.b3_fees, e.irrf_tax,
            e.impacts_managerial_price, e.broker_note_ref, e.notes,
            e.underlying_ticker, a.asset_ticker, a.asset_type, a.id AS asset_id
     FROM invest_ledger_entries e
     JOIN invest_assets a ON a.id = e.asset_id
     WHERE e.organization_id = ? AND e.deleted_at IS NULL
     ORDER BY e.transaction_date, e.id`,
    [ORG]
  );

  // 2. Filtra eventos do ticker (ações) E das opções do mesmo underlying.
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
    brokerage_fee: r.brokerage_fee != null ? Number(r.brokerage_fee) : 0,
    b3_fees: r.b3_fees != null ? Number(r.b3_fees) : 0,
    irrf_tax: r.irrf_tax != null ? Number(r.irrf_tax) : 0,
    impacts_managerial_price: r.impacts_managerial_price == null ? true : !!r.impacts_managerial_price,
    broker_note_ref: r.broker_note_ref ? String(r.broker_note_ref) : null,
    notes: r.notes ? String(r.notes) : null,
  }));

  const tickerEvents = events.filter((e) => e.asset_ticker.toUpperCase() === ticker);
  const optionEvents = events.filter((e) => {
    const t = e.asset_ticker.toUpperCase();
    if (!isOptionTicker(t)) return false;
    const u = inferUnderlyingTicker(t, e.underlying_ticker ?? undefined);
    return u.toUpperCase() === ticker;
  });

  console.log(`\n=== Lançamentos no livro razão de ${ticker} (${tickerEvents.length}) ===`);
  for (const e of tickerEvents) {
    console.log(
      `  ${e.transaction_date}  ${String(e.transaction_type).padEnd(20)} ` +
        `qty=${fmtNum(e.quantity)} @ ${fmtBrl(e.unit_price)}  ` +
        `net=${fmtBrl(e.total_net_value)}  impacts=${e.impacts_managerial_price ? '✓' : '✗'}  ` +
        `${e.broker_note_ref ?? ''}`
    );
  }

  console.log(`\n=== Opções do underlying ${ticker} (${optionEvents.length}) ===`);
  for (const e of optionEvents) {
    console.log(
      `  ${e.transaction_date}  ${e.asset_ticker.padEnd(12)} ${String(e.transaction_type).padEnd(20)} ` +
        `qty=${fmtNum(e.quantity)} @ ${fmtBrl(e.unit_price)}  ` +
        `net=${fmtBrl(e.total_net_value)}  impacts=${e.impacts_managerial_price ? '✓' : '✗'}`
    );
  }

  // 3. Custódia recalculada (toda a organização para comparar lateral)
  const { assets: custodyAssets } = rebuildCustodyFromLedger(events);
  const custody = custodyAssets.find((a) => a.ticker.toUpperCase() === ticker);
  console.log(`\n=== rebuildCustodyFromLedger → ${ticker} ===`);
  if (custody) {
    console.log(
      `  qty=${fmtNum(custody.quantity)}  avgPrice=${fmtBrl(custody.avgPrice)}  assetType=${custody.assetType}`
    );
  } else {
    console.log(`  (não há posição em ${ticker} na custódia recalculada)`);
  }

  // 4. Engine de 3 preços
  const threeMap = computeThreePricesByUnderlying(events);
  const three = threeMap.get(ticker);
  console.log(`\n=== threePricesEngine → ${ticker} ===`);
  if (three) {
    console.log(
      `  qty=${fmtNum(three.qty)}  Estrito=${fmtBrl(three.estrito)}  ` +
        `B3=${fmtBrl(three.b3)}  Gerencial=${fmtBrl(three.gerencial)}  ` +
        `lotStart=${three.lotStart ?? '(nenhum)'}`
    );
  } else {
    console.log(`  (engine não retornou posição para ${ticker})`);
  }

  // 5. Snapshot atual em invest_assets
  const [snapRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT asset_ticker, current_quantity, managerial_avg_price, status
     FROM invest_assets
     WHERE organization_id = ? AND asset_ticker = ? AND deleted_at IS NULL`,
    [ORG, ticker]
  );
  console.log(`\n=== invest_assets snapshot ${ticker} ===`);
  if (snapRows.length === 0) {
    console.log(`  (sem linha em invest_assets)`);
  } else {
    for (const r of snapRows) {
      console.log(
        `  current_quantity=${fmtNum(Number(r.current_quantity))}  ` +
          `managerial_avg_price=${fmtBrl(Number(r.managerial_avg_price))}  status=${r.status}`
      );
    }
  }

  // 6. Resumo numérico das compras de ITUB4 esperadas (informativo)
  const totalBuyQty = tickerEvents
    .filter((e) => ['buy', 'opening_balance', 'bonus'].includes(String(e.transaction_type)))
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0);
  const totalSellQty = tickerEvents
    .filter((e) => String(e.transaction_type) === 'sell')
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0);
  console.log(`\n=== Resumo ${ticker} ===`);
  console.log(`  Soma de quantidade comprada (buy/opening_balance/bonus): ${fmtNum(totalBuyQty)}`);
  console.log(`  Soma de quantidade vendida (sell): ${fmtNum(totalSellQty)}`);
  console.log(`  Líquido: ${fmtNum(totalBuyQty - totalSellQty)}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
