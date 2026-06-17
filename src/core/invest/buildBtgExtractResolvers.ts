import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import type { BtgExtractResolvers } from './BtgExtractLineParser';
import { inferAssetType } from './assetClassifier';
import { isCashInvestTicker } from './cashInvestLedger';

function isoDateBefore(date: string, daysBack: number): string[] {
  const out: string[] = [];
  const base = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return out;
  for (let i = 1; i <= daysBack; i += 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isOptionSellEvent(e: LedgerEvent): boolean {
  const tx = String(e.transaction_type || '').toLowerCase();
  if (tx === 'put_sell' || tx === 'call_sell') return true;
  const type = String(e.asset_type || '').toLowerCase();
  return (type === 'option_call' || type === 'option_put') && Number(e.quantity) < 0;
}

/**
 * Resolvers contextuais do extrato BTG: alocam IRRF de opcao e multas de saldo
 * negativo com base no livro razao ja importado (notas B3 + meses anteriores).
 */
export function buildBtgExtractResolvers(events: LedgerEvent[]): BtgExtractResolvers {
  const optionSells = events.filter(isOptionSellEvent);

  return {
    resolveIrrfOpcaoTicker(extractDate: string) {
      const prior = new Set(isoDateBefore(extractDate, 15));
      const hit = optionSells
        .filter((e) => prior.has(String(e.transaction_date || '').slice(0, 10)))
        .sort((a, b) =>
          String(b.transaction_date || '').localeCompare(String(a.transaction_date || ''))
        )[0];
      if (!hit) return undefined;
      const ticker = String(hit.asset_ticker || '').trim().toUpperCase();
      if (!ticker) return undefined;
      return {
        ticker,
        asset_type: String(hit.asset_type || inferAssetType(ticker)),
      };
    },

    resolveNegativeBalanceAllocation(extractDate: string) {
      const prior = events.filter(
        (e) => String(e.transaction_date || '').slice(0, 10) < extractDate.slice(0, 10)
      );
      const { assets } = rebuildCustodyFromLedger(prior);
      const open = assets.filter(
        (a) =>
          !isCashInvestTicker(a.ticker) &&
          Math.abs(Number(a.quantity)) > 1e-6
      );
      if (!open.length) return undefined;

      const weights = open.map((a) => {
        const qty = Math.abs(Number(a.quantity));
        const mv = qty * Math.abs(Number(a.avgPrice) || 0);
        return { a, mv: mv > 0 ? mv : qty };
      });
      const total = weights.reduce((s, row) => s + row.mv, 0);
      if (total <= 0) return undefined;

      return weights.map(({ a, mv }) => ({
        ticker: a.ticker,
        weight: mv / total,
        asset_type: a.assetType,
        underlying_ticker: a.underlying || a.ticker,
      }));
    },
  };
}
