/**
 * Batimento completo dos três preços (Estrito / B3 / Gerencial) — holding.
 * Gera relatório em texto + JSON em docs/ (para revisão ao acordar).
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD="..."
 *   npx ts-node scripts/validate-three-prices-holding.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../src/core/dal/types';
import { rebuildCustodyFromLedger } from '../src/core/invest/CustodyEngine';
import { inferUnderlyingTicker } from '../src/core/invest/assetClassifier';
import { mergeLedgerCustodyIntoAssetRows } from '../src/core/invest/portfolioMapper';
import {
  buildThreeAvgPricesByUnderlying,
  resolveThreePricesForAsset,
} from '../src/core/invest/portfolioThreePrices';
import { computeThreePricesByUnderlying } from '../src/core/invest/threePricesEngine';
import { validateEquityThreePrices } from '../src/core/invest/threePricesValidation';
import { InvestAssetProjection } from '../src/modules/invest/sync/InvestAssetProjection';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';

async function main() {
  const pool = mysql.createPool({
    host: process.env.REMOTE_DB_HOST || process.env.DB_HOST,
    user: process.env.REMOTE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || 'co_ceo_platform',
  });

  const gateway = new CoCeoDataGateway(pool);
  const ctx = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: ORG,
    impersonatorId: null,
    scope: 'global' as const,
  };

  const projection = new InvestAssetProjection(gateway);
  const ledger = new LedgerEventProjection(gateway);
  const today = new Date().toISOString().slice(0, 10);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', today);
  const engineSnapshots = computeThreePricesByUnderlying(events);
  const threeByUnderlying = buildThreeAvgPricesByUnderlying(events);

  const rows = await projection.listActiveAssets(ctx);
  const { assets: ledgerCustody } = rebuildCustodyFromLedger(events);
  const merged = mergeLedgerCustodyIntoAssetRows(
    rows as Record<string, unknown>[],
    ledgerCustody
  );

  const report: Array<Record<string, unknown>> = [];
  let ok = 0;
  let warn = 0;
  let err = 0;

  for (const row of merged) {
    const ticker = String(row.asset_ticker ?? '').toUpperCase();
    const assetType = String(row.asset_type ?? '');
    if (assetType !== 'stock' && assetType !== 'fii') continue;
    const qty = Number(row.current_quantity ?? 0);
    if (Math.abs(qty) < 1e-6) continue;

    const meta =
      typeof row.metadata === 'string'
        ? (() => {
            try {
              return JSON.parse(row.metadata) as { underlying_ticker?: string };
            } catch {
              return {};
            }
          })()
        : (row.metadata as { underlying_ticker?: string }) || {};

    const und = inferUnderlyingTicker(ticker, meta.underlying_ticker);
    const three = resolveThreePricesForAsset(
      ticker,
      assetType,
      meta.underlying_ticker,
      threeByUnderlying,
      Number(row.managerial_avg_price ?? 0)
    );

    const validation = validateEquityThreePrices({
      ticker,
      custodyQty: qty,
      engineSnapshot: engineSnapshots.get(und) ?? engineSnapshots.get(ticker) ?? null,
      storedExt: {
        strict: row.pm_estrito != null ? Number(row.pm_estrito) : null,
        b3: row.pm_b3 != null ? Number(row.pm_b3) : null,
        managerial: row.pm_gerencial != null ? Number(row.pm_gerencial) : null,
      },
      displayed: three,
    });

    if (validation.status === 'ok') ok += 1;
    else if (validation.status === 'warn') warn += 1;
    else err += 1;

    if (validation.status !== 'ok') {
      report.push({
        ticker,
        qty,
        status: validation.status,
        codes: validation.codes,
        observation: validation.observation,
        engine: validation.engine,
        storedExt: validation.storedExt,
        displayed: validation.displayed,
      });
    }
  }

  const lines = [
    `# Batimento três preços — ${ORG} — ${today}`,
    '',
    `OK: ${ok} · Atenção: ${warn} · Erro: ${err}`,
    '',
    '## Pendências (não OK)',
    '',
  ];

  for (const r of report) {
    lines.push(`### ${r.ticker} (qty ${r.qty}) — **${r.status}**`);
    lines.push(String(r.observation));
    lines.push('');
  }

  const outDir = path.join(process.cwd(), 'docs');
  const mdPath = path.join(outDir, `validacao-tres-precos-${today}.md`);
  const jsonPath = path.join(outDir, `validacao-tres-precos-${today}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({ ok, warn, err, report }, null, 2), 'utf8');

  console.log(lines.join('\n'));
  console.log(`\nArquivos: ${mdPath}`);
  console.log(`         ${jsonPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
