/**
 * Alinha snapshot BTG, cotações, pending zerado e caixa com a tela Investimentos.
 * Uso: node ./node_modules/ts-node/dist/bin.js scripts/sync-necton-patrimony.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { buildDailyPatrimonyMtmSeries } from '../src/core/invest/PatrimonyMtmDailyEngine';
import { loadPatrimonyAnchors } from '../src/core/invest/patrimonyAnchors';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import { PatrimonyDailyRecorder } from '../src/core/invest/PatrimonyDailyRecorder';
import type { LedgerImportLine } from '../src/core/invest/ledgerTypes';

dotenv.config();

const ORG_ID = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

type Snapshot = {
  as_of: string;
  patrimonio_total: number;
  conta_investimento: number;
  total_investido: number;
  lancamentos_futuros: number;
  renda_variavel?: {
    acoes?: { items?: Array<{ ticker: string; last_price?: number; market_value?: number }> };
    opcoes?: { items?: Array<{ ticker: string; last_price?: number; market_value?: number }> };
  };
  renda_fixa?: { total?: number };
};

async function main() {
  const snapPath = path.join(__dirname, '..', 'data', 'invest', 'snapshot-btg-quotes-current.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as Snapshot;
  const AS_OF = snap.as_of || new Date().toISOString().slice(0, 10);
  const NECTON_REF = `NECTON-SNAPSHOT-${AS_OF}`;

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG_ID, scope: 'node' as const };

  type SnapItem = { ticker: string; last_price?: number; market_value?: number };
  const quoteRows: SnapItem[] = [
    ...(snap.renda_variavel?.acoes?.items || []),
    ...(snap.renda_variavel?.opcoes?.items || []),
  ];

  let quotesUpdated = 0;
  for (const q of quoteRows) {
    const ticker = q.ticker?.toUpperCase();
    const lastPrice = Number(q.last_price);
    if (!ticker || !Number.isFinite(lastPrice) || lastPrice < 0) continue;
    const [assets] = await pool.query(
      `SELECT id, metadata FROM invest_assets WHERE organization_id = ? AND asset_ticker = ? LIMIT 1`,
      [ORG_ID, ticker]
    );
    const row = (assets as { id: string; metadata: unknown }[])[0];
    if (!row) continue;
    let meta: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        meta =
          typeof row.metadata === 'string'
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : (row.metadata as Record<string, unknown>);
      } catch {
        meta = {};
      }
    }
    meta.last_price = lastPrice;
    meta.quote_as_of = AS_OF;
    if (q.market_value != null) meta.market_value_snapshot = q.market_value;
    await gateway.update(ctx, 'invest_assets', row.id, { metadata: JSON.stringify(meta) });
    quotesUpdated += 1;
  }
  console.log(`Cotações snapshot → ${quotesUpdated} ativos (${AS_OF})`);

  const [oldPending] = await pool.query(
    `SELECT id, total_net_value FROM invest_ledger_entries
     WHERE organization_id = ? AND transaction_type = 'pending_settlement'
       AND (broker_note_ref IS NULL OR broker_note_ref NOT LIKE 'AUTO-D2:%')`,
    [ORG_ID]
  );

  let offset = 0;
  for (const row of oldPending as { total_net_value: string }[]) {
    offset += Number(row.total_net_value);
  }

  const entries: LedgerImportLine[] = [];
  if (Math.abs(offset) > 0.01) {
    entries.push({
      date: AS_OF,
      ticker: 'CAIXA-BTG',
      asset_type: 'cash',
      operation: 'pending_settlement',
      quantity: 0,
      unit_price: 0,
      total_net_value: -offset,
      broker_note_ref: `${NECTON_REF}:CLEAR-BTG-PENDING`,
      notes: `Zera previsão BTG anterior (soma ${offset.toFixed(2)}) — lanç. futuros = 0`,
      impacts_managerial_price: false,
    });
  }

  const targetCash = Number(snap.conta_investimento);
  const cashAsOf = process.env.CASH_RECON_DATE || '2026-05-18';
  if (Number.isFinite(targetCash)) {
    const eventsBefore = await ledger.listLedgerEvents(ctx, '2000-01-01', cashAsOf);
    let ledgerCash = 0;
    for (const e of eventsBefore) {
      const ticker = String(e.asset_ticker).toUpperCase();
      const assetType = String(e.asset_type);
      if (assetType !== 'cash' && !ticker.startsWith('CAIXA-')) continue;
      if (String(e.transaction_date).slice(0, 10) > cashAsOf) continue;
      const net = Number(e.total_net_value ?? 0);
      if (net !== 0) ledgerCash += net;
      else if (e.transaction_type === 'opening_balance') {
        ledgerCash += Math.abs(Number(e.quantity)) * Number(e.unit_price || 1);
      }
    }
    const cashDelta = Math.round((targetCash - ledgerCash) * 100) / 100;
    if (Math.abs(cashDelta) > 0.01) {
      entries.push({
        date: cashAsOf,
        ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        operation: 'cash_yield',
        quantity: 0,
        unit_price: 0,
        total_net_value: cashDelta,
        broker_note_ref: `${NECTON_REF}:CASH-RECON`,
        notes: `Ajuste caixa BTG ${ledgerCash.toFixed(2)} → ${targetCash.toFixed(2)} (conta investimento)`,
        impacts_managerial_price: false,
      });
      console.log(`Ajuste caixa: ${ledgerCash.toFixed(2)} → ${targetCash.toFixed(2)} (Δ ${cashDelta.toFixed(2)})`);
    }
  }

  if (entries.length) {
    const imp = await ledger.importEntriesOnly(ctx, entries, {
      sourceLabel: `BTG patrimônio ${AS_OF}`,
    });
    console.log('Ledger:', JSON.stringify(imp, null, 2));
  }

  await ledger.syncAutoPendingSettlements(ctx);

  const anchors = loadPatrimonyAnchors();
  const assets = await gateway.findWhere(ctx, 'invest_assets', {
    organization_id: ORG_ID,
    status: 'active',
  });
  const stockQuotes: Record<string, number> = {};
  for (const row of assets) {
    const ticker = String(row.asset_ticker ?? '').toUpperCase();
    let meta: { last_price?: number } = {};
    if (row.metadata) {
      try {
        meta =
          typeof row.metadata === 'string'
            ? JSON.parse(row.metadata)
            : (row.metadata as { last_price?: number });
      } catch {
        meta = {};
      }
    }
    const lp = Number(meta.last_price ?? row.managerial_avg_price ?? 0);
    if (Number.isFinite(lp) && lp >= 0) stockQuotes[ticker] = lp;
  }

  const events = await ledger.listLedgerEvents(ctx, '2026-01-01', AS_OF);
  const pat = buildDailyPatrimonyMtmSeries(events, '2026-01-01', AS_OF, {
    anchors,
    stockQuotes,
    fixedIncomeTotal: Number(anchors.fixed_income_total ?? 0),
  });
  const last = pat.series[pat.series.length - 1];

  console.log('\n--- Conferência ---');
  console.log('BTG patrimônio alvo:', snap.patrimonio_total);
  if (last) {
    console.log('Motor patrimônio:', last.patrimony);
    console.log('Motor caixa:', last.cash);
    console.log('Motor posições:', last.positionsValue);
  }

  const recorder = new PatrimonyDailyRecorder(gateway);
  const saved = await recorder.recordDay(ctx, AS_OF);
  console.log('\nFechamento gravado:', saved.snapshotDate, 'patrimônio', saved.recorded.patrimony);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
