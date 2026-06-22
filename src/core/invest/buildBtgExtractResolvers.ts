import type { LedgerEvent } from './CustodyEngine';
import { rebuildCustodyFromLedger } from './CustodyEngine';
import type { BtgExtractResolvers } from './BtgExtractLineParser';
import { inferAssetType, isFixedIncomeTicker } from './assetClassifier';
import { isCashInvestTicker } from './cashInvestLedger';
import { harmonizeQuantityWithFinancialAmount } from './financialQuantityCoherence';

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

export type PortfolioWeightAllocation = {
  ticker: string;
  weight: number;
  asset_type?: string;
  underlying_ticker?: string;
};

/** Pondera posicoes abertas (nao-caixa) por valor de mercado na data do extrato. */
export function resolvePortfolioWeightAllocation(
  events: LedgerEvent[],
  extractDate: string
): PortfolioWeightAllocation[] | undefined {
  const prior = events.filter(
    (e) => String(e.transaction_date || '').slice(0, 10) < extractDate.slice(0, 10)
  );
  const { assets } = rebuildCustodyFromLedger(prior);
  const open = assets.filter(
    (a) => !isCashInvestTicker(a.ticker) && Math.abs(Number(a.quantity)) > 1e-6
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
      return resolvePortfolioWeightAllocation(events, extractDate);
    },

    resolveCustodyFeeAllocation(extractDate: string) {
      return resolvePortfolioWeightAllocation(events, extractDate);
    },

    resolveLftSpotFromGross(extractDate, ticker, gross, operation, maxQuantity) {
      const d = extractDate.slice(0, 10);
      const prior = events.filter((e) => String(e.transaction_date || '').slice(0, 10) < d);
      const { assets } = rebuildCustodyFromLedger(prior);
      const row = assets.find(
        (a) =>
          String(a.ticker).toUpperCase() === ticker.toUpperCase() ||
          (isFixedIncomeTicker(ticker) && isFixedIncomeTicker(a.ticker))
      );
      const refPu = row && Number(row.avgPrice) > 0 ? Number(row.avgPrice) : 0;
      const custodyQty = operation === 'sell' && row ? Math.max(0, Number(row.quantity)) : undefined;
      const available =
        custodyQty != null
          ? maxQuantity != null
            ? Math.min(custodyQty, maxQuantity)
            : custodyQty
          : undefined;
      if (refPu <= 0) return undefined;
      if (operation === 'sell' && (available == null || available <= 0)) return undefined;

      if (operation === 'sell' && available != null) {
        const rawQty = gross / refPu;
        const puMin = refPu * 0.98;
        const puMax = refPu * 1.15;
        const estQty = Math.round((gross / (refPu * 1.05)) * 100) / 100;
        const targetPu = gross / Math.max(estQty, 0.01);

        const isValid = (q: number, pu: number) =>
          q > 0 &&
          q <= available + 1e-6 &&
          Math.abs(q * pu - gross) <= 0.01 &&
          pu >= puMin &&
          pu <= puMax;

        const pickBest = (q: number, pu: number, best?: { quantity: number; unitPrice: number; score: number }) => {
          const score = Math.abs(pu - targetPu);
          if (!best || score < best.score) return { quantity: q, unitPrice: pu, score };
          return best;
        };

        const intHi = Math.min(
          Math.floor(available),
          Math.max(1, Math.ceil(gross / puMin) + 2)
        );
        let bestInt: { quantity: number; unitPrice: number; score: number } | undefined;
        for (let q = 1; q <= intHi; q++) {
          const pu = Math.round((gross / q) * 10000) / 10000;
          if (!isValid(q, pu)) continue;
          bestInt = pickBest(q, pu, bestInt);
        }
        if (bestInt) return { quantity: bestInt.quantity, unitPrice: bestInt.unitPrice };

        let bestFrac: { quantity: number; unitPrice: number; score: number } | undefined;
        const center = Math.round(rawQty * 100);
        const fracHi = Math.min(Math.round(available * 100), center + 120);
        for (let c = Math.max(1, center - 120); c <= fracHi; c++) {
          const q = c / 100;
          const pu = Math.round((gross / q) * 10000) / 10000;
          if (!isValid(q, pu)) continue;
          bestFrac = pickBest(q, pu, bestFrac);
        }
        if (bestFrac) return { quantity: bestFrac.quantity, unitPrice: bestFrac.unitPrice };
      }

      const hit = harmonizeQuantityWithFinancialAmount({
        financialAmount: gross,
        referenceUnitPrice: refPu,
        maxQuantity: operation === 'sell' ? available : undefined,
      });
      if (!hit) return undefined;
      return { quantity: hit.quantity, unitPrice: hit.unit_price };
    },

    resolveLftQuantityBeforeDate(ticker, extractDate) {
      const d = extractDate.slice(0, 10);
      const prior = events.filter((e) => String(e.transaction_date || '').slice(0, 10) < d);
      const { assets } = rebuildCustodyFromLedger(prior);
      const row = assets.find(
        (a) =>
          String(a.ticker).toUpperCase() === ticker.toUpperCase() ||
          (isFixedIncomeTicker(ticker) && isFixedIncomeTicker(a.ticker))
      );
      return row ? Number(row.quantity) : 0;
    },
  };
}
