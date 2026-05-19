/**
 * Diagnóstico: rentabilidade do sistema vs BTG (TWR e patrimônio).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { loadPatrimonyAnchors } from '../src/core/invest/patrimonyAnchors';
import { computePortfolioPerformance } from '../src/core/invest/portfolioPerformance';
import { listExternalFlows } from '../src/core/invest/portfolioPerformance';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

const BTG_MONTHLY_CARTEIRA = [
  { month: '2026-01', pct: 0.085 },
  { month: '2026-02', pct: 0.0176 },
  { month: '2026-03', pct: 0.0479 },
  { month: '2026-04', pct: 0.0729 },
  { month: '2026-05', pct: 0.03 },
];

function compoundMonthly(returns: number[]): number {
  return returns.reduce((f, r) => f * (1 + r), 1) - 1;
}

async function main() {
  const anchors = loadPatrimonyAnchors();
  const patPath = path.join(__dirname, '..', 'data', 'invest', 'patrimony-daily-2026.json');
  const cached = JSON.parse(fs.readFileSync(patPath, 'utf8')) as {
    performance?: { periodReturnTwr: number; periodGainBrl: number; startPatrimony: number; endPatrimony: number };
    series: Array<{ date: string; patrimony: number; dailyReturn: number | null }>;
  };

  console.log('=== BTG (capturas) ===');
  console.log('Rentab. mensal carteira (tabela):', BTG_MONTHLY_CARTEIRA.map((m) => `${m.month} ${(m.pct * 100).toFixed(2)}%`).join(', '));
  const btgCompound = compoundMonthly(BTG_MONTHLY_CARTEIRA.map((m) => m.pct));
  console.log('Composto Jan–Mai (BTG):', (btgCompound * 100).toFixed(2) + '% (~27,86% no app)');

  console.log('\n=== Âncoras BTG (patrimônio fim de mês) ===');
  for (const m of anchors.month_ends) {
    if (m.date >= '2025-12-01' && m.date <= '2026-06-01') console.log(m.date, m.patrimony.toLocaleString('pt-BR'));
  }

  const dec = anchors.month_ends.find((m) => m.date === '2025-12-31')!.patrimony;
  const jan = anchors.month_ends.find((m) => m.date === '2026-01-31')!.patrimony;
  const feb = anchors.month_ends.find((m) => m.date === '2026-02-28')!.patrimony;
  const mar = anchors.month_ends.find((m) => m.date === '2026-03-31')!.patrimony;
  const apr = anchors.month_ends.find((m) => m.date === '2026-04-30')!.patrimony;
  const may = anchors.month_ends.find((m) => m.date === '2026-05-18')!.patrimony;

  const anchorMonthly = [
    (jan - dec) / dec,
    (feb - jan) / jan,
    (mar - feb) / feb,
    (apr - mar) / mar,
    (may - apr) / apr,
  ];
  console.log('\nRetorno implícito nas âncoras (%):', anchorMonthly.map((r) => (r * 100).toFixed(2)).join(', '));
  console.log('Composto âncoras Jan–Mai:', (compoundMonthly(anchorMonthly) * 100).toFixed(2) + '%');

  console.log('\n=== Sistema (patrimony-daily-2026.json) ===');
  if (cached.performance) {
    console.log('TWR 2026-01-01 → fim:', (cached.performance.periodReturnTwr * 100).toFixed(2) + '%');
    console.log('Ganho BRL:', cached.performance.periodGainBrl?.toLocaleString('pt-BR'));
    console.log('Patrimônio início/fim:', cached.performance.startPatrimony, '→', cached.performance.endPatrimony);
  }

  const jan1 = cached.series.find((p) => p.date === '2026-01-01');
  const jan31 = cached.series.find((p) => p.date === '2026-01-31');
  const may19 = cached.series.find((p) => p.date === '2026-05-19');
  if (jan1 && jan31) {
    const janRet = (jan31.patrimony - jan1.patrimony) / jan1.patrimony;
    console.log('Retorno simples Jan (série diária):', (janRet * 100).toFixed(2) + '%');
    const drs = cached.series.filter((p) => p.date >= '2026-01-01' && p.date <= '2026-01-31' && p.dailyReturn != null);
    const uniq = [...new Set(drs.map((p) => p.dailyReturn))];
    console.log('Valores únicos dailyReturn em Jan:', uniq.slice(0, 5).join(', '), uniq.length === 1 ? '(constante → interpolação!)' : '');
  }
  if (may19) console.log('Patrimônio 19/05 série:', may19.patrimony);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const assets = await gateway.findWhere(ctx, 'invest_assets', { organization_id: ORG, status: 'active' });
  const stockQuotes: Record<string, number> = {};
  for (const row of assets) {
    const ticker = String(row.asset_ticker ?? '').toUpperCase();
    let meta: { last_price?: number } = {};
    if (row.metadata) {
      try {
        meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as { last_price?: number });
      } catch {
        meta = {};
      }
    }
    const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
    if (Number.isFinite(lp) && lp >= 0) stockQuotes[ticker] = lp;
  }

  const events = await ledger.listLedgerEvents(ctx, '2025-12-01', '2026-05-31');
  const flows = listExternalFlows(events, '2025-12-31', '2026-05-31');
  console.log('\n=== Fluxos externos (capital_deposit/withdrawal) ===');
  console.log('Total:', flows.length, 'lançamentos, soma', flows.reduce((s, f) => s + f.amount, 0).toLocaleString('pt-BR'));
  for (const f of flows.slice(0, 10)) console.log(' ', f.date, f.operation, f.amount);
  if (flows.length > 10) console.log(' ...');

  const suspicious = events.filter(
    (e) =>
      String(e.transaction_type).includes('cash') ||
      String(e.broker_note_ref || '').includes('CASH-RECON')
  );
  console.log('\nLançamentos cash/recon:', suspicious.length);
  for (const e of suspicious.slice(0, 5)) {
    console.log(
      ' ',
      String(e.transaction_date).slice(0, 10),
      e.transaction_type,
      e.total_net_value,
      e.broker_note_ref
    );
  }

  for (const from of ['2026-01-01', '2025-12-31']) {
    const to = '2026-05-19';
    const mtm = buildDailyPatrimonyMtmSeries(events, from, to, {
      anchors,
      stockQuotes,
      fixedIncomeTotal: Number(anchors.fixed_income_total ?? 0),
    });
    const perf = mtm.performance;
    console.log(`\n=== Motor ao vivo ${from} → ${to} ===`);
    if (perf) {
      console.log('TWR:', (perf.periodReturnTwr * 100).toFixed(2) + '%');
      console.log('Ganho:', perf.periodGainBrl.toLocaleString('pt-BR'));
      console.log('Patrimônio:', perf.startPatrimony, '→', perf.endPatrimony);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
