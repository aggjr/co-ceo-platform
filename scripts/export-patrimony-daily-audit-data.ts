import fs from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';
import pool from '../src/config/database';
import { CoCeoDataGateway, SYSTEM_INSTALLER_USER_ID, type UserContext } from '../src/core/dal';
import { InvestController } from '../src/controllers/InvestController';

const ORG_ID = process.env.PATRIMONY_AUDIT_ORG_ID || 'org-holding-001';
const FROM = process.env.PATRIMONY_AUDIT_FROM || '2026-01-01';
const TO = process.env.PATRIMONY_AUDIT_TO || '2026-06-14';

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

function round2(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) < 0.005 ? 0 : r;
}

function daySerial(date: string): number {
  return Math.round(new Date(`${date}T12:00:00Z`).getTime() / 86_400_000);
}

function monthLastDay(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function interpolate(date: string, anchors: Array<{ date: string; value: number }>): number | null {
  const points = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  if (date <= points[0]!.date) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (date >= last.date) return last.value;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (date >= a.date && date <= b.date) {
      const span = daySerial(b.date) - daySerial(a.date);
      const w = span === 0 ? 0 : (daySerial(date) - daySerial(a.date)) / span;
      return Math.round((a.value + (b.value - a.value) * w) * 100) / 100;
    }
  }
  return last.value;
}

function findMonthlyJsonDir(repoRoot: string): string {
  const dataRoot = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)} (dados)`);
  return dataRoot;
}

async function loadMonthlyJsonAnchors(repoRoot: string) {
  const dataRoot = findMonthlyJsonDir(repoRoot);
  const dirs = await fs.readdir(dataRoot, { withFileTypes: true });
  const monthlyDirName = dirs.find((d) => {
    const normalized = d.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return d.isDirectory() && normalized.includes('dados patrimonio mensal');
  })?.name;
  if (!monthlyDirName) {
    throw new Error(`Pasta de JSONs mensais nao encontrada em ${dataRoot}`);
  }
  const monthlyDir = path.join(dataRoot, monthlyDirName);
  const filenames = [
    'JAN_2026.json',
    'FEV_2026.json',
    'MAR_2026.json',
    'ABR_2026.json',
    'MAI_2026.json',
    'JUN_2026.json',
    'JUN_2026_ATUAL.JSON',
    'carteira atualizada.json',
  ];

  const extra = await fs.readdir(monthlyDir);
  for (const name of extra) {
    if (/^carteira_atualizada.*\.json$/i.test(name) && !filenames.includes(name)) {
      filenames.push(name);
    }
  }

  const records: Array<{
    file: string;
    date: string;
    value: number;
    kind: string;
    usableAnchor: boolean;
    note: string;
    components?: Record<string, unknown>;
  }> = [];

  for (const file of filenames) {
    const full = path.join(monthlyDir, file);
    try {
      await fs.access(full);
    } catch {
      continue;
    }
    const raw = JSON.parse(await fs.readFile(full, 'utf8')) as Record<string, any>;
    if (file === 'carteira atualizada.json' || /^carteira_atualizada/i.test(file)) {
      records.push({
        file,
        date: String(raw.data_referencia).slice(0, 10),
        value: Number(raw.patrimonio?.total ?? 0),
        kind: 'snapshot_homebroker',
        usableAnchor: true,
        note: 'Snapshot detalhado da carteira atualizada com total, classes e ativos.',
        components: raw.patrimonio,
      });
      continue;
    }
    if (file === 'JUN_2026_ATUAL.JSON') {
      records.push({
        file,
        date: String(raw.periodo?.fim).slice(0, 10),
        value: Number(raw.patrimonio_final ?? 0),
        kind: 'parcial_homebroker',
        usableAnchor: true,
        note: 'Fechamento parcial informado no JSON atual.',
        components: raw.detalhamento,
      });
      continue;
    }
    const month = String(raw.mes ?? '').slice(0, 7);
    const date = monthLastDay(month);
    records.push({
      file,
      date,
      value: Number(raw.patrimonio_final ?? 0),
      kind: month === '2026-06' ? 'mensal_futuro_ou_nominal' : 'fechamento_mensal',
      usableAnchor: month !== '2026-06',
      note:
        month === '2026-06'
          ? 'Referencia de junho completo; nao usada como ancora efetiva antes de 30/06.'
          : 'Fechamento mensal extraido do JSON do homebroker.',
      components: {
        patrimonio_inicial: raw.patrimonio_inicial,
        rendimentos: raw.rendimentos,
        aportes_retiradas: raw.aportes_retiradas,
        impostos: raw.impostos,
      },
    });
  }

  return {
    monthlyDir,
    records,
    anchors: records
      .filter((r) => r.usableAnchor)
      .map((r) => ({ date: r.date, value: r.value, file: r.file }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

async function invokePatrimonyDaily(controller: InvestController, ctx: UserContext) {
  return await new Promise<Record<string, any>>((resolve, reject) => {
    const req = {
      userContext: ctx,
      query: { from: FROM, to: TO, method: 'mtm_economic' },
    } as any;
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: Record<string, any>) {
        if (this.statusCode >= 400 || payload?.success === false) {
          reject(new Error(JSON.stringify(payload)));
        } else {
          resolve(payload);
        }
        return this;
      },
    } as any;
    controller.getPatrimonyDaily(req, res).catch(reject);
  });
}

async function main() {
  const repoRoot = process.cwd();
  const outputDir = path.join(repoRoot, 'reports');
  await fs.mkdir(outputDir, { recursive: true });

  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: ORG_ID,
    impersonatorId: null,
    scope: 'global',
  };
  const gateway = new CoCeoDataGateway(pool);
  const controller = new InvestController(gateway);

  const jsonAnchors = await loadMonthlyJsonAnchors(repoRoot);
  const apiData = await invokePatrimonyDaily(controller, ctx);

  const [portfolioRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, organization_id, snapshot_date, patrimony, patrimony_gross, cash,
            positions_value, settled_cash, cash_in_transit, pending_settlements,
            fixed_income_total, external_flow, daily_return_simple, daily_return_twr,
            cumulative_twr, quotes_as_of, source, metadata
       FROM invest_portfolio_daily
      WHERE organization_id = ?
        AND snapshot_date BETWEEN ? AND ?
      ORDER BY snapshot_date`,
    [ORG_ID, FROM, TO]
  );

  const [positionAggRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT snapshot_date,
            COUNT(*) AS position_rows,
            SUM(CASE WHEN price_source IN ('black_scholes','estimated_decay','cost','previous_market','expired_zero') THEN 1 ELSE 0 END) AS estimated_rows,
            SUM(CASE WHEN price_source = 'black_scholes' THEN 1 ELSE 0 END) AS black_scholes_rows,
            SUM(CASE WHEN price_source = 'previous_market' THEN 1 ELSE 0 END) AS previous_market_rows,
            SUM(CASE WHEN price_source = 'cost' THEN 1 ELSE 0 END) AS cost_rows,
            SUM(CASE WHEN price_source = 'expired_zero' THEN 1 ELSE 0 END) AS expired_zero_rows,
            SUM(CASE WHEN price_source = 'market' THEN 1 ELSE 0 END) AS market_rows,
            SUM(total_value) AS position_daily_total,
            SUM(CASE WHEN asset_type = 'fixed_income' THEN total_value ELSE 0 END) AS fixed_income_position_total,
            GROUP_CONCAT(CASE
              WHEN price_source IN ('black_scholes','estimated_decay','cost','previous_market','expired_zero')
              THEN CONCAT(ticker, ':', price_source)
              ELSE NULL
            END ORDER BY ABS(total_value) DESC SEPARATOR ', ') AS estimated_tickers
       FROM invest_position_daily
      WHERE organization_id = ?
        AND snapshot_date BETWEEN ? AND ?
      GROUP BY snapshot_date
      ORDER BY snapshot_date`,
    [ORG_ID, FROM, TO]
  );

  const [positionDetailRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT snapshot_date, ticker, asset_type, account_key, broker_code,
            quantity, closing_price, total_value, managerial_avg_price,
            managerial_value, unrealized_pnl, price_source, source
       FROM invest_position_daily
      WHERE organization_id = ?
        AND snapshot_date BETWEEN ? AND ?
      ORDER BY snapshot_date, asset_type, ticker`,
    [ORG_ID, FROM, TO]
  );

  const [dbAnchorRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT reference_date, patrimony, source, notes
       FROM invest_patrimony_monthly_anchors
      WHERE organization_id = ?
        AND reference_date BETWEEN ? AND ?
      ORDER BY reference_date`,
    [ORG_ID, FROM, TO]
  );

  const [optionRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS rows_count, COUNT(DISTINCT ticker) AS distinct_tickers,
            MIN(expiration_date) AS min_expiration, MAX(expiration_date) AS max_expiration
       FROM invest_options_market`
  );

  const [optionTickerRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ticker, underlying_ticker, option_type, strike_price, expiration_date
       FROM invest_options_market
      ORDER BY underlying_ticker, expiration_date, ticker`
  );

  const [quoteCoverageRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ticker, COUNT(*) AS rows_count, MIN(quote_date) AS min_date, MAX(quote_date) AS max_date
       FROM market_quotes_daily
      WHERE quote_date BETWEEN ? AND ?
      GROUP BY ticker
      ORDER BY ticker`,
    [FROM, TO]
  );

  const seriesByDate = new Map(
    (apiData.series || []).map((p: Record<string, any>) => [isoDate(p.date), p])
  );
  const indexedByDate = new Map(
    (apiData.portfolioIndexed || []).map((p: Record<string, any>) => [isoDate(p.date), p])
  );
  const storedByDate = new Map(portfolioRows.map((r) => [isoDate(r.snapshot_date), r]));
  const positionAggByDate = new Map(positionAggRows.map((r) => [isoDate(r.snapshot_date), r]));
  const anchorByDate = new Map(jsonAnchors.records.map((r) => [r.date, r]));

  const dailyRows: Array<Record<string, unknown>> = [];
  let previousApi: number | null = null;
  let previousStored: number | null = null;
  for (const date of enumerateDates(FROM, TO)) {
    const api = seriesByDate.get(date) as Record<string, any> | undefined;
    const indexed = indexedByDate.get(date) as Record<string, any> | undefined;
    const stored = storedByDate.get(date) as mysql.RowDataPacket | undefined;
    const pos = positionAggByDate.get(date) as mysql.RowDataPacket | undefined;
    const expected = interpolate(date, jsonAnchors.anchors);
    const apiPatrimony = round2(api?.patrimony);
    const storedPatrimony = round2(stored?.patrimony);
    const apiDeltaPct =
      previousApi != null && apiPatrimony != null && previousApi !== 0
        ? Math.round(((apiPatrimony - previousApi) / previousApi) * 1_000_000) / 1_000_000
        : null;
    const storedDeltaPct =
      previousStored != null && storedPatrimony != null && previousStored !== 0
        ? Math.round(((storedPatrimony - previousStored) / previousStored) * 1_000_000) / 1_000_000
        : null;
    if (apiPatrimony != null) previousApi = apiPatrimony;
    if (storedPatrimony != null) previousStored = storedPatrimony;

    const anchor = anchorByDate.get(date);
    const deltaApiExpected =
      apiPatrimony != null && expected != null ? round2(apiPatrimony - expected) : null;
    const deltaStoredExpected =
      storedPatrimony != null && expected != null ? round2(storedPatrimony - expected) : null;
    const deltaApiStored =
      apiPatrimony != null && storedPatrimony != null ? round2(apiPatrimony - storedPatrimony) : null;
    const chartReturn = indexed?.periodReturnToDate ?? (indexed?.indexedLevel != null ? Number(indexed.indexedLevel) / 100 - 1 : null);

    const flags: string[] = [];
    if (anchor && apiPatrimony != null && Math.abs(apiPatrimony - anchor.value) > 1) flags.push('API difere do JSON');
    if (anchor && storedPatrimony != null && Math.abs(storedPatrimony - anchor.value) > 1) flags.push('Gravado difere do JSON');
    if (anchor && storedPatrimony == null) flags.push('Sem fechamento gravado na ancora JSON');
    if (stored == null) flags.push('Sem fechamento gravado');
    if (deltaApiStored != null && Math.abs(deltaApiStored) > 1) flags.push('API difere do gravado');
    if (apiDeltaPct != null && Math.abs(apiDeltaPct) >= 0.02) flags.push('Salto API >= 2%');
    if (storedDeltaPct != null && Math.abs(storedDeltaPct) >= 0.02) flags.push('Salto gravado >= 2%');
    if (chartReturn != null && Number(chartReturn) <= -0.2) flags.push('Grafico <= -20%');
    if (chartReturn != null && Number(chartReturn) <= -0.5) flags.push('Grafico <= -50%');
    if (Number(pos?.black_scholes_rows ?? 0) > 0) flags.push('Black-Scholes');
    if (Number(pos?.expired_zero_rows ?? 0) > 0) flags.push('Opcao zerada por vencimento');
    if (Number(pos?.cost_rows ?? 0) > 0) flags.push('Preco a custo');
    if (Number(pos?.previous_market_rows ?? 0) > 0) flags.push('Cotacao anterior');

    dailyRows.push({
      date,
      json_anchor_total: anchor?.value ?? null,
      json_anchor_file: anchor?.file ?? null,
      expected_total_interpolated_from_json: expected,
      api_screen_patrimony: apiPatrimony,
      stored_patrimony: storedPatrimony,
      delta_api_vs_json_expected: deltaApiExpected,
      delta_stored_vs_json_expected: deltaStoredExpected,
      delta_api_vs_stored: deltaApiStored,
      api_daily_delta_pct: apiDeltaPct,
      stored_daily_delta_pct: storedDeltaPct,
      chart_period_return_pct: chartReturn != null ? Math.round(Number(chartReturn) * 10000) / 100 : null,
      stored_cumulative_twr_pct:
        stored?.cumulative_twr != null ? Math.round(Number(stored.cumulative_twr) * 10000) / 100 : null,
      cash: round2(api?.settledCash ?? api?.cash ?? stored?.cash),
      cash_in_transit: round2(api?.cashInTransit ?? stored?.cash_in_transit),
      api_positions_value: round2(api?.positionsValue),
      stored_positions_value: round2(stored?.positions_value),
      stored_fixed_income_total: round2(stored?.fixed_income_total),
      external_flow: round2(stored?.external_flow),
      quotes_as_of: stored?.quotes_as_of ? isoDate(stored.quotes_as_of) : null,
      stored_source: stored?.source ?? null,
      position_rows: Number(pos?.position_rows ?? 0),
      market_rows: Number(pos?.market_rows ?? 0),
      estimated_rows: Number(pos?.estimated_rows ?? 0),
      black_scholes_rows: Number(pos?.black_scholes_rows ?? 0),
      previous_market_rows: Number(pos?.previous_market_rows ?? 0),
      cost_rows: Number(pos?.cost_rows ?? 0),
      expired_zero_rows: Number(pos?.expired_zero_rows ?? 0),
      estimated_tickers: String(pos?.estimated_tickers ?? ''),
      flags: flags.join('; '),
    });
  }

  const monthlyComparison = jsonAnchors.records.map((anchor) => {
    const api = seriesByDate.get(anchor.date) as Record<string, any> | undefined;
    const indexed = indexedByDate.get(anchor.date) as Record<string, any> | undefined;
    const stored = storedByDate.get(anchor.date) as mysql.RowDataPacket | undefined;
    return {
      file: anchor.file,
      date: anchor.date,
      kind: anchor.kind,
      usable_anchor: anchor.usableAnchor,
      json_homebroker_total: anchor.value,
      api_screen_total: round2(api?.patrimony),
      stored_total: round2(stored?.patrimony),
      delta_api_vs_json: api?.patrimony != null ? round2(Number(api.patrimony) - anchor.value) : null,
      delta_stored_vs_json: stored?.patrimony != null ? round2(Number(stored.patrimony) - anchor.value) : null,
      chart_period_return_pct:
        indexed?.periodReturnToDate != null
          ? Math.round(Number(indexed.periodReturnToDate) * 10000) / 100
          : null,
      note: anchor.note,
    };
  });

  const flaggedDates = new Set(
    dailyRows
      .filter((r) => String(r.flags || '').length > 0)
      .map((r) => String(r.date))
  );
  for (const anchor of jsonAnchors.records) flaggedDates.add(anchor.date);

  const positionDetails = positionDetailRows
    .map((r) => ({
      snapshot_date: isoDate(r.snapshot_date),
      ticker: String(r.ticker ?? ''),
      asset_type: String(r.asset_type ?? ''),
      account_key: String(r.account_key ?? ''),
      broker_code: r.broker_code ?? null,
      quantity: Number(r.quantity ?? 0),
      closing_price: Number(r.closing_price ?? 0),
      total_value: round2(r.total_value),
      managerial_avg_price: r.managerial_avg_price != null ? Number(r.managerial_avg_price) : null,
      managerial_value: round2(r.managerial_value),
      unrealized_pnl: round2(r.unrealized_pnl),
      price_source: String(r.price_source ?? ''),
      source: String(r.source ?? ''),
    }))
    .filter((r) => flaggedDates.has(r.snapshot_date));

  const firstApiStoredDivergence = dailyRows.find(
    (r) => Number.isFinite(Number(r.delta_api_vs_stored)) && Math.abs(Number(r.delta_api_vs_stored)) > 1
  );
  const firstLargeApiDrop = dailyRows.find((r) => Number(r.api_daily_delta_pct ?? 0) <= -0.02);
  const firstLargeChartDrop = dailyRows.find((r) => Number(r.chart_period_return_pct ?? 0) <= -20);

  const diagnostics = {
    generated_at: new Date().toISOString(),
    organization_id: ORG_ID,
    period: { from: FROM, to: TO },
    api_method: 'mtm_economic',
    api_last_point: (apiData.series || []).at(-1) ?? null,
    api_daily_recording: apiData.dailyRecording ?? null,
    api_market_quotes: apiData.marketQuotes ?? null,
    api_btg_reference: apiData.btgReference ?? null,
    first_api_vs_stored_divergence: firstApiStoredDivergence ?? null,
    first_large_api_drop: firstLargeApiDrop ?? null,
    first_large_chart_drop: firstLargeChartDrop ?? null,
    stored_rows: portfolioRows.length,
    stored_first_date: portfolioRows[0] ? isoDate(portfolioRows[0].snapshot_date) : null,
    stored_last_date: portfolioRows.at(-1) ? isoDate(portfolioRows.at(-1)!.snapshot_date) : null,
    option_catalog: {
      rows_count: Number(optionRows[0]?.rows_count ?? 0),
      distinct_tickers: Number(optionRows[0]?.distinct_tickers ?? 0),
      min_expiration: optionRows[0]?.min_expiration ? isoDate(optionRows[0].min_expiration) : null,
      max_expiration: optionRows[0]?.max_expiration ? isoDate(optionRows[0].max_expiration) : null,
    },
  };

  const output = {
    diagnostics,
    monthly_json_directory: jsonAnchors.monthlyDir,
    monthly_json_anchors: jsonAnchors.records,
    db_anchors: dbAnchorRows.map((r) => ({
      reference_date: isoDate(r.reference_date),
      patrimony: round2(r.patrimony),
      source: String(r.source ?? ''),
      notes: String(r.notes ?? ''),
    })),
    monthly_comparison: monthlyComparison,
    daily_rows: dailyRows,
    position_details: positionDetails,
    option_catalog_tickers: optionTickerRows.map((r) => ({
      ticker: String(r.ticker ?? ''),
      underlying_ticker: String(r.underlying_ticker ?? ''),
      option_type: String(r.option_type ?? ''),
      strike_price: Number(r.strike_price ?? 0),
      expiration_date: isoDate(r.expiration_date),
    })),
    quote_coverage: quoteCoverageRows.map((r) => ({
      ticker: String(r.ticker ?? ''),
      rows_count: Number(r.rows_count ?? 0),
      min_date: isoDate(r.min_date),
      max_date: isoDate(r.max_date),
    })),
  };

  const outFile = path.join(outputDir, 'patrimony_daily_audit_2026_data.json');
  await fs.writeFile(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({
    outFile,
    lastApiPatrimony: diagnostics.api_last_point?.patrimony ?? null,
    storedRows: diagnostics.stored_rows,
    storedLastDate: diagnostics.stored_last_date,
    firstApiVsStoredDivergence: diagnostics.first_api_vs_stored_divergence?.date ?? null,
    firstLargeChartDrop: diagnostics.first_large_chart_drop?.date ?? null,
  }, null, 2));

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
