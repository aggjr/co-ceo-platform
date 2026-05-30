import type { CoCeoDataGateway, UserContext } from '../dal';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import { LedgerImportService } from './LedgerImportService';
import { computeThreePricesByUnderlying } from './threePricesEngine';

export type PnLRow = {
  ticker: string;
  assetType: string;
  qtyAberta: number;
  pmGerencial: number;
  bookValue: number;
  marketValue: number | null;
  realizedGross: number;
  realizedCost: number;
  realizedPnL: number;
  dividends: number;
  jcp: number;
  securitiesLending: number;
  optionPremiumsReceived: number;
  optionPremiumsPaid: number;
  optionPremiumNet: number;
  totalPnL: number;
};

export class PnLReportService {
  private readonly ledger: LedgerImportService;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.ledger = new LedgerImportService(gateway);
  }

  async buildReport(ctx: UserContext, from: string, to: string): Promise<PnLRow[]> {
    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', to);
    const periodEvents = events.filter((e) => {
      const d = String(e.transaction_date ?? '').slice(0, 10);
      return d >= from && d <= to;
    });

    const { assets } = rebuildCustodyFromLedger(events);
    const priceMap = computeThreePricesByUnderlying(events);

    const extRows = await this.gateway.findWhere(ctx, 'invest_position_ext', {});
    const lastPriceByAssetId = new Map(
      extRows.map((r) => [String(r.patrimony_item_id), Number(r.last_price ?? 0)])
    );

    const byUnderlying = new Map<string, PnLRow>();

    const getRow = (ticker: string, assetType: string): PnLRow => {
      if (!byUnderlying.has(ticker)) {
        byUnderlying.set(ticker, {
          ticker,
          assetType,
          qtyAberta: 0,
          pmGerencial: 0,
          bookValue: 0,
          marketValue: null,
          realizedGross: 0,
          realizedCost: 0,
          realizedPnL: 0,
          dividends: 0,
          jcp: 0,
          securitiesLending: 0,
          optionPremiumsReceived: 0,
          optionPremiumsPaid: 0,
          optionPremiumNet: 0,
          totalPnL: 0,
        });
      }
      return byUnderlying.get(ticker)!;
    };

    for (const e of periodEvents) {
      const ticker = String(e.asset_ticker ?? '');
      const type = String(e.transaction_type);
      const net = Number(e.total_net_value ?? 0);
      const row = getRow(ticker, e.asset_type);

      if (type === 'sell') {
        row.realizedGross += Math.abs(net);
      }
      if (type === 'dividend') row.dividends += Math.abs(net);
      if (type === 'jcp') row.jcp += Math.abs(net);
      if (type === 'securities_lending') row.securitiesLending += Math.abs(net);
      if (type === 'call_sell' || type === 'put_sell') {
        row.optionPremiumsReceived += Math.abs(net);
      }
      if (type === 'call_buy' || type === 'put_buy') {
        row.optionPremiumsPaid += Math.abs(net);
      }
    }

    for (const asset of assets) {
      if (asset.assetType === 'cash') continue;
      const row = getRow(asset.ticker, asset.assetType);
      const tp = priceMap.get(asset.underlying ?? asset.ticker);
      const pmG = tp?.gerencial ?? asset.avgPrice;

      row.qtyAberta = asset.quantity;
      row.pmGerencial = pmG;
      row.bookValue = Math.round(asset.quantity * pmG * 100) / 100;

      const lp = lastPriceByAssetId.get(asset.assetId) ?? 0;
      row.marketValue = lp > 0 ? Math.round(asset.quantity * lp * 100) / 100 : null;

      row.realizedCost = Math.round(row.realizedGross * (pmG / Math.max(pmG, 0.01)) * 100) / 100;
      row.realizedPnL = Math.round((row.realizedGross - row.realizedCost) * 100) / 100;

      row.optionPremiumNet = Math.round(
        (row.optionPremiumsReceived - row.optionPremiumsPaid) * 100
      ) / 100;

      row.totalPnL = Math.round(
        (row.realizedPnL +
          row.dividends +
          row.jcp +
          row.securitiesLending +
          row.optionPremiumNet) *
          100
      ) / 100;
    }

    return Array.from(byUnderlying.values())
      .filter((r) => r.qtyAberta > 0 || r.totalPnL !== 0)
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }
}
