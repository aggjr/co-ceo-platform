import type { CoCeoDataGateway, UserContext } from '../dal';
import { MarketQuoteRepository } from '../market/MarketQuoteRepository';
import { inferUnderlyingTicker, isOptionTicker } from './assetClassifier';
import { fetchOpcoesNetOptionsChainAll } from './opcoesNetClient';
import { parseOpcoesNetExpirations } from './opcoesNetChainParser';
import { OptionMarketRepository } from './OptionMarketRepository';

export type OptionMarketSyncReport = {
  underlyings: string[];
  rowsParsed: number;
  inserted: number;
  updated: number;
  errors: Array<{ underlying: string; message: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atualiza invest_options_market a partir do opcoes.net.br para ações-mãe
 * com opções em custódia em qualquer cliente.
 */
export class OptionMarketSyncService {
  private readonly marketRepo: OptionMarketRepository;
  private readonly quoteRepo: MarketQuoteRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.marketRepo = new OptionMarketRepository(gateway);
    this.quoteRepo = new MarketQuoteRepository(gateway);
  }

  async listUnderlyingsWithOptionsInUse(ctx: UserContext): Promise<string[]> {
    const tickers = await this.quoteRepo.listTickersInUse(ctx);
    const underlyings = new Set<string>();
    for (const t of tickers) {
      if (!isOptionTicker(t)) continue;
      underlyings.add(inferUnderlyingTicker(t));
    }
    return [...underlyings].sort();
  }

  async syncFromOpcoesNet(
    ctx: UserContext,
    options?: { underlyings?: string[]; asOfDate?: string; delayMs?: number }
  ): Promise<OptionMarketSyncReport> {
    const underlyings =
      options?.underlyings?.length
        ? options.underlyings.map((u) => u.trim().toUpperCase())
        : await this.listUnderlyingsWithOptionsInUse(ctx);

    const asOfDate = options?.asOfDate ?? new Date().toISOString().slice(0, 10);
    const delayMs = options?.delayMs ?? 400;

    let rowsParsed = 0;
    let inserted = 0;
    let updated = 0;
    const errors: OptionMarketSyncReport['errors'] = [];

    for (const underlying of underlyings) {
      try {
        const expirations = await fetchOpcoesNetOptionsChainAll(underlying);
        const parsed = parseOpcoesNetExpirations(underlying, expirations, asOfDate);
        rowsParsed += parsed.length;
        const result = await this.marketRepo.upsertMany(ctx, parsed);
        inserted += result.inserted;
        updated += result.updated;
      } catch (err) {
        errors.push({
          underlying,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (delayMs > 0) await sleep(delayMs);
    }

    return { underlyings, rowsParsed, inserted, updated, errors };
  }
}
