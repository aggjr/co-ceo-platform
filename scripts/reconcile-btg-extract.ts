/**
 * Batimento: extratos BTG (conta corrente) vs livro-razão INVEST.
 */
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { installerContext } from '../src/database/seeds/lib/installerContext';
import { LedgerImportService } from '../src/core/invest/LedgerImportService';
import {
  buildExtractReconciliationSummary,
  loadBtgExtractCashDailySeries,
  listExtractTeds,
} from '../src/core/invest/btgExtractCashSeries';
import { listExternalFlows } from '../src/core/invest/portfolioPerformance';
import { compareToBtgPublished, btgPublishedTwr } from '../src/core/invest/btgPerformanceReference';
import { loadPatrimonyAnchors } from '../src/core/invest/patrimonyAnchors';

dotenv.config();

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const summary = buildExtractReconciliationSummary();
  console.log('=== Extratos BTG no repositório ===');
  console.log('Arquivos:', summary.extractFiles.join(', '));
  console.log('Linhas com saldo:', summary.movementLines);
  console.log('Período:', summary.firstDate, '→', summary.lastDate);
  console.log(
    'Último saldo extrato (conta corrente):',
    summary.lastExtractCashBalance?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  );
  console.log('\n', summary.note);

  console.log('\n=== TEDs no extrato ===');
  for (const t of summary.tedsInExtract) {
    console.log(t.date, t.amount.toLocaleString('pt-BR'), t.description.slice(0, 50));
  }

  console.log('\n=== Saldo extrato fim de mês (último dia com movimento no mês) ===');
  for (const m of summary.monthEndCash) {
    const bal =
      m.extractBalance != null
        ? m.extractBalance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '—';
    console.log(m.date, bal);
  }

  const anchors = loadPatrimonyAnchors();
  console.log('\n=== Patrimônio total BTG (âncoras — não vem do extrato) ===');
  for (const m of anchors.month_ends) {
    if (m.date >= '2025-12-31' && m.date <= '2026-05-31') {
      console.log(m.date, m.patrimony.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
    }
  }

  const btgTwr = btgPublishedTwr('2026-01', '2026-05');
  console.log('\nRentab. BTG publicada Jan–Mai:', btgTwr != null ? `${(btgTwr * 100).toFixed(2)}%` : '—');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
  });
  const gateway = new CoCeoDataGateway(pool);
  const ledger = new LedgerImportService(gateway);
  const ctx = { ...installerContext(), organizationId: ORG, scope: 'node' as const };

  const events = await ledger.listLedgerEvents(ctx, '2026-01-01', '2026-05-31');
  const flows = listExternalFlows(events, '2026-01-01', '2026-05-31');

  console.log('\n=== TEDs no livro (capital_deposit / capital_withdrawal) ===');
  for (const f of flows) {
    console.log(f.date, f.amount.toLocaleString('pt-BR'), f.operation);
  }

  const extractTeds = listExtractTeds(loadBtgExtractCashDailySeries().series);
  let tedOk = true;
  for (const et of extractTeds) {
    const match = flows.find(
      (f) => f.date === et.date && Math.abs(f.amount - et.amount) < 0.02
    );
    if (!match) {
      tedOk = false;
      console.warn('FALTA no livro:', et.date, et.amount);
    }
  }
  console.log(tedOk ? '\nTEDs: OK (extrato = livro)' : '\nTEDs: divergência — reimportar btg-augusto-h1-2026.json');

  const importJson = path.join(__dirname, '..', 'data', 'invest', 'btg-augusto-h1-2026.json');
  console.log('\nImport JSON:', importJson);
  console.log('Regerar: node ./node_modules/ts-node/dist/bin.js scripts/build-btg-extract-import.ts');
  console.log('Importar: node ./node_modules/ts-node/dist/bin.js scripts/import-invest-augusto.ts');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
