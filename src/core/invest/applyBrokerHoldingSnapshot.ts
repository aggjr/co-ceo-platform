import type { CoCeoDataGateway, UserContext } from '../dal';
import { authBootstrapContext } from '../auth/authBootstrapContext';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { InvestQuoteSyncService } from './InvestQuoteSyncService';
import { inferAssetType } from './assetClassifier';
import { BrokerCustodySnapshotRepository } from './BrokerCustodySnapshotRepository';
import { MAIN_CASH_TICKER } from './ledgerTypes';
import {
  marksFromSnapshotLines,
  sumBrokerMarks,
  type BrokerCustodySnapshotRecord,
  type BrokerPositionMark,
} from './brokerCustodySnapshotTypes';

export type ApplyBrokerSnapshotResult = {
  asOf: string;
  snapshotId: string;
  quotesUpdated: number;
  positionsTouched: number;
  positionsMissing: string[];
  cashAccountUpdated: boolean;
  anchorPatrimony: number;
  impliedFromMarks: {
    stocks: number;
    options: number;
    sum: number;
  };
};

const TICKER_ALIASES: Record<string, string[]> = {
  WEGER441: ['WEGER41'],
};

async function findPatrimonyItemId(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  ticker: string
): Promise<string | null> {
  const candidates = [ticker.toUpperCase(), ...(TICKER_ALIASES[ticker.toUpperCase()] ?? [])];
  for (const id of candidates) {
    const rows = await gateway.findWhere(
      ctx,
      'patrimony_items',
      {
        organization_id: ctx.organizationId,
        source_module: 'INVEST',
        identifier: id,
      },
      { limit: 1, columns: ['id'] }
    );
    if (rows[0]?.id) return String(rows[0].id);
  }
  return null;
}

async function applyMark(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  marketQuotes: MarketQuoteRepository,
  quoteSync: InvestQuoteSyncService,
  mark: BrokerPositionMark,
  asOf: string
): Promise<boolean> {
  const ticker = mark.ticker.toUpperCase();
  const itemId = await findPatrimonyItemId(gateway, ctx, ticker);
  if (!itemId) return false;

  const marketCtx = authBootstrapContext();
  await marketQuotes.upsertQuote(marketCtx, {
    ticker,
    quoteDate: asOf,
    closingPrice: mark.lastPrice,
    source: 'user_manual',
    metadata: { broker_custody_snapshot: true },
  });

  const type = inferAssetType(ticker);
  if (type === 'option_call' || type === 'option_put') {
    await quoteSync.applySnapshotOptions(ctx, [{ ticker, last_price: mark.lastPrice }], asOf);
  } else {
    await quoteSync.applyLastPrices(ctx, [{ ticker, last_price: mark.lastPrice }], asOf);
  }

  await gateway.update(ctx, 'patrimony_items', itemId, {
    current_value: Math.round(mark.marketValue * 100) / 100,
  });
  return true;
}

async function upsertPatrimonyAnchor(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  asOf: string,
  patrimony: number
): Promise<void> {
  const existing = await gateway.findWhere(
    ctx,
    'invest_patrimony_monthly_anchors',
    { organization_id: ctx.organizationId, reference_date: asOf },
    { limit: 1, columns: ['id'] }
  );
  const payload = {
    organization_id: ctx.organizationId,
    reference_date: asOf,
    patrimony: Math.round(patrimony * 10000) / 10000,
    source: 'btg_custody',
    notes: 'Snapshot homebroker (composição patrimonial)',
  };
  if (existing[0]?.id) {
    await gateway.update(ctx, 'invest_patrimony_monthly_anchors', String(existing[0].id), payload);
  } else {
    await gateway.insert(ctx, 'invest_patrimony_monthly_anchors', {
      id: `ipa-broker-${asOf}`,
      ...payload,
    });
  }
}

async function upsertFixedIncomeAnchor(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  total: number
): Promise<void> {
  const existing = await gateway.findWhere(
    ctx,
    'invest_patrimony_monthly_anchors',
    {
      organization_id: ctx.organizationId,
      source: 'fixed_income_total',
    },
    { limit: 1, columns: ['id'] }
  );
  const payload = {
    organization_id: ctx.organizationId,
    reference_date: '1970-01-01',
    patrimony: Math.round(total * 10000) / 10000,
    source: 'fixed_income_total',
    notes: 'RF total — snapshot homebroker',
  };
  if (existing[0]?.id) {
    await gateway.update(ctx, 'invest_patrimony_monthly_anchors', String(existing[0].id), payload);
  } else {
    await gateway.insert(ctx, 'invest_patrimony_monthly_anchors', {
      id: 'ipa-holding-fi-broker',
      ...payload,
    });
  }
}

async function updateCashDisplay(
  gateway: CoCeoDataGateway,
  ctx: UserContext,
  balance: number
): Promise<boolean> {
  const itemId = await findPatrimonyItemId(gateway, ctx, MAIN_CASH_TICKER);
  if (!itemId) return false;
  const rounded = Math.round(balance * 100) / 100;
  await gateway.update(ctx, 'patrimony_items', itemId, { current_value: rounded });
  return true;
}

function splitStockOptionMarks(snapshot: BrokerCustodySnapshotRecord): {
  stocks: BrokerPositionMark[];
  options: BrokerPositionMark[];
} {
  const marks = marksFromSnapshotLines(snapshot.positions);
  const stocks: BrokerPositionMark[] = [];
  const options: BrokerPositionMark[] = [];
  for (const m of marks) {
    const t = inferAssetType(m.ticker);
    if (t === 'option_call' || t === 'option_put') options.push(m);
    else stocks.push(m);
  }
  return { stocks, options };
}

/**
 * Aplica snapshot importado no banco (cotações, patrimony_items, âncoras).
 * Pré-requisito: `import-broker-custody-snapshot.ts` com JSON do homebroker.
 */
export async function applyBrokerHoldingSnapshot(
  gateway: CoCeoDataGateway,
  organizationId: string,
  asOf?: string
): Promise<ApplyBrokerSnapshotResult> {
  const date = (asOf ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const ctx: UserContext = { ...authBootstrapContext(), organizationId, scope: 'node' as const };
  const repo = new BrokerCustodySnapshotRepository(gateway);
  const snapshot =
    (await repo.loadByReferenceDate(ctx, date)) ?? (await repo.loadLatest(ctx));
  if (!snapshot) {
    throw new Error(
      `Nenhum snapshot de custódia BTG em invest_broker_custody_snapshots para ${date}. ` +
        'Importe antes: npm run import:broker:snapshot -- local-import/btg-sources/custody-snapshot.json'
    );
  }

  const marketQuotes = new MarketQuoteRepository(gateway);
  const quoteSync = new InvestQuoteSyncService(gateway);
  const { stocks, options } = splitStockOptionMarks(snapshot);
  const comp = snapshot.composition;

  const missing: string[] = [];
  let touched = 0;
  let quotes = 0;

  for (const mark of [...stocks, ...options]) {
    const ok = await applyMark(gateway, ctx, marketQuotes, quoteSync, mark, date);
    if (ok) {
      touched += 1;
      quotes += 1;
    } else {
      missing.push(mark.ticker);
    }
  }

  const cashOk = await updateCashDisplay(gateway, ctx, comp.cash);
  await upsertFixedIncomeAnchor(gateway, ctx, comp.fixedIncome);
  await upsertPatrimonyAnchor(gateway, ctx, date, comp.totalPatrimony);
  await repo.markApplied(ctx, snapshot.id);

  return {
    asOf: date,
    snapshotId: snapshot.id,
    quotesUpdated: quotes,
    positionsTouched: touched,
    positionsMissing: missing,
    cashAccountUpdated: cashOk,
    anchorPatrimony: comp.totalPatrimony,
    impliedFromMarks: {
      stocks: sumBrokerMarks(stocks),
      options: sumBrokerMarks(options),
      sum: Math.round((sumBrokerMarks(stocks) + sumBrokerMarks(options)) * 100) / 100,
    },
  };
}
