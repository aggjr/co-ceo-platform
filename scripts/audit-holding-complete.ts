/**
 * Conferência geral holding org-holding-001 — auditável e coerente com (dados).
 *
 * Verifica:
 *   - Fechamentos mensais JSON vs invest_portfolio_daily
 *   - Cobertura de cotações (market_quotes_daily)
 *   - Três preços (Estrito/B3/Gerencial) por ação
 *   - Pivot resultado (remunerações por coluna)
 *   - Tipos de lançamento não mapeados no pivot
 *   - Âncoras mensais no banco
 *
 *   npx ts-node scripts/audit-holding-complete.ts
 *   npx ts-node scripts/audit-holding-complete.ts --json
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildPnLPivot } from '../src/core/invest/PnLPivotEngine';
import { buildStockUnderlyingPivot } from '../src/core/invest/StockUnderlyingPivotEngine';
import { PIVOT_COLUMNS } from '../src/core/invest/ledgerTypes';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import { buildThreeAvgPricesByUnderlying } from '../src/core/invest/portfolioThreePrices';
import { ThreePricesContextFactory } from '../src/core/invest/ThreePricesContextFactory';
import { inferUnderlyingTicker } from '../src/core/invest/assetClassifier';
import { PatrimonyMonthlyAnchorsRepository } from '../src/core/invest/PatrimonyMonthlyAnchorsRepository';
import {
  loadMonthlyClosesFromDados,
  loadSnapshotFromDados,
} from './lib/patrimony-dados-json';
import { createInvestPool } from './lib/invest-db-pool';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const JSON_OUT = process.argv.includes('--json');
const TOLERANCE = 1.0;

function brl(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0, 12)).toISOString().slice(0, 10);
}

async function main() {
  const pool = createInvestPool();
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);

  const issues: string[] = [];
  const sections: Record<string, unknown> = {};

  // --- 1. Fechamentos mensais ---
  const jsonCloses = loadMonthlyClosesFromDados();
  const snapshot = loadSnapshotFromDados();
  const monthEndRows = [];
  for (const row of jsonCloses) {
    const endDate = row.month === '2026-06' ? null : row.date;
    let stored: number | null = null;
    if (endDate) {
      const [[r]] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT patrimony FROM invest_portfolio_daily
         WHERE organization_id=? AND snapshot_date=? LIMIT 1`,
        [ORG, endDate]
      );
      stored = r ? Number(r.patrimony) : null;
    }
    const delta = stored != null ? stored - row.patrimonio_final : null;
    const ok = delta == null ? null : Math.abs(delta) <= TOLERANCE;
    if (ok === false) {
      issues.push(`Patrimônio ${row.month} fim: gravado ${brl(stored)} vs JSON ${brl(row.patrimonio_final)} (Δ ${brl(delta)})`);
    }
    monthEndRows.push({
      mês: row.month,
      data: endDate ?? '(parcial)',
      json: row.patrimonio_final,
      gravado: stored,
      delta,
      ok: ok == null ? 'parcial' : ok ? 'OK' : 'DIVERGENTE',
    });
  }

  if (snapshot) {
    const [[snapRow]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT patrimony FROM invest_portfolio_daily WHERE organization_id=? AND snapshot_date=? LIMIT 1`,
      [ORG, snapshot.date]
    );
    const stored = snapRow ? Number(snapRow.patrimony) : null;
    const delta = stored != null ? stored - snapshot.total : null;
    const ok = delta == null ? false : Math.abs(delta) <= TOLERANCE;
    if (!ok) {
      issues.push(`Snapshot ${snapshot.date}: gravado ${brl(stored)} vs JSON ${brl(snapshot.total)}`);
    }
    monthEndRows.push({
      mês: 'snapshot',
      data: snapshot.date,
      json: snapshot.total,
      gravado: stored,
      delta,
      ok: ok ? 'OK' : stored == null ? 'SEM_DADO' : 'DIVERGENTE',
    });
  }
  sections.monthly_patrimony = monthEndRows;

  // --- 2. Âncoras ---
  const anchorsRepo = new PatrimonyMonthlyAnchorsRepository(gateway);
  const anchors = await anchorsRepo.loadForOrganization(ctx);
  sections.anchors = {
    count: anchors.month_ends.length,
    fixed_income_total: anchors.fixed_income_total,
    points: anchors.month_ends,
  };
  if (anchors.month_ends.length < 5) {
    issues.push('Poucas âncoras mensais — rode seed-patrimony-anchors-from-dados.ts');
  }

  // --- 3. Cotações ---
  const [stockTickers] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT identifier ticker FROM patrimony_items
     WHERE organization_id=? AND subcategory IN ('stock','fii') AND quantity > 0 AND deleted_at IS NULL`,
    [ORG]
  );
  const tickers = stockTickers.map((r) => String(r.ticker));
  const quoteRows = [];
  for (const ticker of tickers) {
    const [[q]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT MIN(quote_date) min_d, MAX(quote_date) max_d, COUNT(*) c
       FROM market_quotes_daily WHERE ticker=?`,
      [ticker]
    );
    const count = Number(q?.c ?? 0);
    const ok = count >= 100;
    if (!ok) issues.push(`Cotação ${ticker}: apenas ${count} dia(s) em market_quotes_daily`);
    quoteRows.push({ ticker, min: q?.min_d, max: q?.max_d, days: count, ok: ok ? 'OK' : 'INSUFICIENTE' });
  }
  sections.quotes = quoteRows;

  // --- 4. Três preços ---
  const threeFactory = new ThreePricesContextFactory(gateway);
  const threeCtx = await threeFactory.build(ctx);
  const threeOpts = { ctx: threeCtx };
  const threeMap = buildThreeAvgPricesByUnderlying(events, threeOpts);
  const engineMap = computeThreePricesByUnderlying(events, threeOpts, today);

  const [hbStocks] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT identifier, quantity, acquisition_value FROM patrimony_items
     WHERE organization_id=? AND subcategory='stock' AND quantity > 0 AND deleted_at IS NULL`,
    [ORG]
  );

  const threePriceRows = [];
  for (const row of hbStocks) {
    const ticker = String(row.identifier).toUpperCase();
    const underlying = inferUnderlyingTicker(ticker) || ticker;
    const qty = Number(row.quantity);
    const prices = threeMap.get(underlying);
    const engine = engineMap.get(underlying);
    const ok =
      prices &&
      prices.strict > 0 &&
      prices.b3 > 0 &&
      prices.managerial > 0 &&
      engine &&
      engine.qty > 0;
    if (!ok) issues.push(`Três preços incompletos: ${ticker} (underlying ${underlying})`);
    threePriceRows.push({
      ticker,
      qty,
      estrito: prices?.strict ?? null,
      b3: prices?.b3 ?? null,
      gerencial: prices?.managerial ?? null,
      engine_qty: engine?.qty ?? null,
      ok: ok ? 'OK' : 'ATENÇÃO',
    });
  }
  sections.three_prices = threePriceRows;

  // --- 5. Pivot resultado ---
  const pnlPivot = buildPnLPivot(events, '2026-01-01', today);
  const pivotSummary: Record<string, number> = {};
  for (const col of PIVOT_COLUMNS) pivotSummary[col] = 0;
  for (const row of pnlPivot.rows) {
    for (const col of PIVOT_COLUMNS) {
      pivotSummary[col] += Number(row[col] ?? 0);
    }
  }
  const pivotNonZero = Object.entries(pivotSummary)
    .filter(([, v]) => Math.abs(v) > 0.01)
    .map(([col, total]) => ({ coluna: col, total }));
  sections.pnl_pivot_totals = pivotNonZero;
  sections.pnl_pivot_row_count = pnlPivot.rows.length;

  const stockPivot = buildStockUnderlyingPivot(events, '2026-01-01', today);
  sections.stock_gain_pivot_rows = stockPivot.rows.length;

  // --- 6. Lançamentos não mapeados no pivot ---
  const mappedTypes = new Set([
    'dividend', 'jcp', 'put_sell', 'put_buy', 'call_sell', 'call_buy',
    'securities_lending', 'fee', 'capital_deposit', 'capital_withdrawal',
    'cash_yield', 'penalty_b3', 'sell', 'option_exercise', 'buy',
    'opening_balance', 'split', 'revaluation',
  ]);
  const typeCounts = new Map<string, number>();
  for (const e of events) {
    const t = String(e.transaction_type ?? 'unknown');
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const knownInternalTypes = new Set([
    'cost_adjustment',
    'pending_settlement',
    'fee',
    'extract_divergence',
  ]);
  const unmapped = [...typeCounts.entries()]
    .filter(([t]) => !mappedTypes.has(t) && !knownInternalTypes.has(t))
    .map(([type, count]) => ({ type, count }));
  if (unmapped.length) {
    for (const u of unmapped) {
      issues.push(`Tipo de lançamento não mapeado no pivot: ${u.type} (${u.count}x)`);
    }
  }
  sections.known_internal_types = [...knownInternalTypes].map((type) => ({
    type,
    count: typeCounts.get(type) ?? 0,
    note:
      type === 'cost_adjustment'
        ? 'Taxas/emolumentos no livro patrimonial — não entram no pivot de resultado'
        : type === 'pending_settlement'
          ? 'Caixa em trânsito — conciliação financeira'
          : type === 'extract_divergence'
            ? 'Ajuste de batimento extrato vs livro — ver conciliação'
            : 'Despesa operacional',
  }));
  sections.unmapped_transaction_types = unmapped;
  sections.transaction_type_counts = Object.fromEntries(typeCounts);

  // --- 7. Livro ---
  const [[ledgerCount]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) c FROM patrimony_ledger_entries WHERE organization_id=? AND deleted_at IS NULL`,
    [ORG]
  );
  const [[dailyCount]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) c, MIN(snapshot_date) min_d, MAX(snapshot_date) max_d
     FROM invest_portfolio_daily WHERE organization_id=?`,
    [ORG]
  );
  sections.ledger_entries = Number(ledgerCount?.c ?? 0);
  sections.invest_portfolio_daily = dailyCount;

  // --- Relatório ---
  const report = {
    generated_at: new Date().toISOString(),
    org: ORG,
    issue_count: issues.length,
    issues,
    ...sections,
  };

  const outDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'holding_audit_complete.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== AUDITORIA GERAL HOLDING ===\n');
    console.log('## Fechamentos mensais (JSON vs gravado)');
    console.table(monthEndRows.map((r) => ({
      mês: r.mês,
      data: r.data,
      JSON: brl(r.json as number),
      gravado: brl(r.gravado as number | null),
      Δ: brl(r.delta as number | null),
      status: r.ok,
    })));

    console.log('\n## Cotações (ações em carteira)');
    console.table(quoteRows);

    console.log('\n## Três preços (ações)');
    console.table(
      threePriceRows.map((r) => ({
        ticker: r.ticker,
        qty: r.qty,
        estrito: r.estrito?.toFixed(4),
        b3: r.b3?.toFixed(4),
        gerencial: r.gerencial?.toFixed(4),
        status: r.ok,
      }))
    );

    console.log('\n## Pivot resultado — totais por coluna (não zero)');
    console.table(pivotNonZero.map((r) => ({ coluna: r.coluna, total: brl(r.total) })));
    console.log(`Linhas no pivot: ${pnlPivot.rows.length} | Ganhos por ação: ${stockPivot.rows.length}`);

    if (unmapped.length) {
      console.log('\n## Tipos NÃO mapeados no pivot (identificar na conciliação)');
      console.table(unmapped);
    }

    console.log(`\nÂncoras: ${anchors.month_ends.length} | Livro: ${sections.ledger_entries} | Diário: ${dailyCount?.c} dias`);
    console.log(`\nProblemas: ${issues.length}`);
    for (const i of issues) console.log(`  - ${i}`);
    console.log(`\nRelatório JSON: ${outPath}`);
    console.log(issues.length === 0 ? '\n✓ Conferência OK' : '\n⚠ Revise os itens acima');
  }

  await pool.end();
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
