/**
 * Preenche invest_option_ext (strike + vencimento) para opções da holding.
 * Fontes: mapa de exercícios no livro + strikes da abertura 01/01/2026 (PRIO).
 *
 * Uso:
 *   $env:REMOTE_DB_PASSWORD="..."
 *   npx ts-node scripts/backfill-option-ext-holding.ts
 *   npx ts-node scripts/backfill-option-ext-holding.ts --apply
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { CoCeoDataGateway } from '../src/core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../src/core/dal/types';
import { LedgerEventProjection } from '../src/modules/invest/sync/LedgerEventProjection';
import { buildOptionStrikeMapFromLedgerEvents } from '../src/core/invest/optionStrikeFromLedger';
import { inferOptionExpiryDate, inferOptionMonthFromTicker } from '../src/core/invest/optionExpiry';
import { inferUnderlyingTicker, isOptionTicker } from '../src/core/invest/assetClassifier';

const ORG = process.env.PORTFOLIO_ORG_ID || 'org-holding-001';
const APPLY = process.argv.includes('--apply');

/** Abertura 01/01/2026 — strikes explícitos (não inferir do ticker). */
const OPENING_STRIKES: Record<string, number> = {
  PRIOQ43: 43,
  PRIOR407: 40.7,
  PRIOA407: 40.7,
};

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

  const ledger = new LedgerEventProjection(gateway);
  const events = await ledger.listLedgerEvents(ctx, '2000-01-01', '2099-12-31');
  const fromExercises = buildOptionStrikeMapFromLedgerEvents(events);
  const strikeByTicker = new Map<string, number>(Object.entries(OPENING_STRIKES));
  for (const [t, s] of fromExercises) strikeByTicker.set(t, s);

  const items = await gateway.findWhere(ctx, 'patrimony_items', {
    organization_id: ORG,
    source_module: 'INVEST',
  });

  let would = 0;
  let done = 0;

  for (const item of items) {
    const ticker = String(item.identifier ?? '').toUpperCase();
    if (!isOptionTicker(ticker)) continue;
    if (Math.abs(Number(item.quantity ?? 0)) < 1e-6) continue;

    const strike = strikeByTicker.get(ticker);
    if (strike == null || strike <= 0) {
      console.log(`  — sem strike: ${ticker}`);
      continue;
    }

    const month = inferOptionMonthFromTicker(ticker);
    const expiration = inferOptionExpiryDate(ticker);
    const underlying = inferUnderlyingTicker(ticker);
    if (!month || !expiration || !underlying) {
      console.log(`  — metadados B3 incompletos: ${ticker}`);
      continue;
    }

    would += 1;
    console.log(
      `${APPLY ? '✓' : '○'} ${ticker} strike=${strike} und=${underlying} exp=${expiration}`
    );

    if (!APPLY) continue;

    const existing = await gateway.findWhere(ctx, 'invest_option_ext', {
      patrimony_item_id: String(item.id),
    });
    const payload = {
      option_type: month.optionSide === 'call' ? 'CALL' : 'PUT',
      underlying_ticker: underlying,
      strike_price: strike,
      expiration_date: expiration,
      european_american: 'A' as const,
    };
    if (existing.length) {
      await gateway.update(ctx, 'invest_option_ext', String(item.id), payload);
    } else {
      await gateway.insert(ctx, 'invest_option_ext', {
        patrimony_item_id: String(item.id),
        ...payload,
      });
    }
    done += 1;
  }

  console.log(`\n${APPLY ? 'Gravados' : 'Simulados'}: ${APPLY ? done : would}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
