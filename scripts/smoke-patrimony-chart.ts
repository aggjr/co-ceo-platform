/**
 * Smoke: série patrimonial 2026-01-01 → ontem (mesma lógica da API).
 * Uso: npx ts-node scripts/smoke-patrimony-chart.ts
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { loadPatrimonyAnchors } from '../src/core/invest/patrimonyAnchors';
import { fixedIncomeTotalFromLedger } from '../src/core/invest/patrimonyLedgerGates';
import { MarketQuoteRepository } from '../src/core/market/MarketQuoteRepository';
import {
  PatrimonyDailyStore,
  mergeStoredPatrimonySeries,
  trimZeroPatrimonyTailAfterLastStored,
} from '../src/core/invest/PatrimonyDailyStore';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const FROM = '2026-01-01';

function yesterdayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const to = yesterdayIso();
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_platform',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };
  const ledger = new LedgerImportService(gateway);
  const market = new MarketQuoteRepository(gateway);
  const store = new PatrimonyDailyStore(gateway);

  const events = await ledger.listLedgerEvents(ctx, FROM, to);
  const quoteMap = await market.loadQuoteMapForRange(ctx, FROM, to);
  const quoteForDate =
    quoteMap.size > 0 ? market.buildQuoteForDateFn(quoteMap) : undefined;

  let result = buildDailyPatrimonyMtmSeries(events, FROM, to, {
    anchors: loadPatrimonyAnchors(),
    stockQuotes: {},
    fixedIncomeTotal: fixedIncomeTotalFromLedger(events),
    calibrateToAnchors: false,
    quoteForDate,
  });

  const stored = await store.loadRange(ctx, FROM, to);
  if (stored.length) {
    const merged = mergeStoredPatrimonySeries(result.series, stored);
    result = {
      ...result,
      series: trimZeroPatrimonyTailAfterLastStored(merged.series, stored),
    };
  }

  const first = result.series[0];
  const last = result.series[result.series.length - 1];
  console.log('Período:', FROM, '→', to);
  console.log('Lançamentos livro:', events.length);
  console.log('Cotações mercado:', quoteMap.size, 'tickers');
  console.log('Fechamentos gravados:', stored.length);
  console.log('Pontos na série:', result.series.length);
  if (first && last) {
    console.log('Patrimônio inicial:', first.patrimony.toLocaleString('pt-BR'));
    console.log('Patrimônio final:', last.patrimony.toLocaleString('pt-BR'));
  }
  if (result.performance) {
    console.log('TWR período:', ((result.performance.periodReturnTwr ?? 0) * 100).toFixed(2) + '%');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
