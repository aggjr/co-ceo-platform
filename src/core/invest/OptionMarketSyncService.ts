import type { CoCeoDataGateway, UserContext } from '../dal';
import { SYSTEM_INSTALLER_USER_ID } from '../dal/types';
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
  cacheHit?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const optionMarketGlobalCtx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: null,
  impersonatorId: null,
  scope: 'global',
};

const optionMarketRunCache = new Map<string, OptionMarketSyncReport>();

function optionMarketCacheKey(ctx: UserContext, underlyings: string[]): string {
  const owner = ctx.organizationId ? `org:${ctx.organizationId}` : 'global';
  return `${owner}|${underlyings.join(',')}`;
}

/**
 * Atualiza invest_options_market a partir do opcoes.net.br para ações-mãe
 * com opções em custódia em qualquer cliente.
 */
export class OptionMarketSyncService {
  private readonly marketRepo: OptionMarketRepository;

  constructor(private readonly gateway: CoCeoDataGateway) {
    this.marketRepo = new OptionMarketRepository(gateway);
  }

  /** Custódia real em patrimony_items (não exige invest_position_ext). */
  async listUnderlyingsWithOptionsInUse(ctx: UserContext): Promise<string[]> {
    const rows = ctx.organizationId
      ? await this.gateway.readQuery(
          optionMarketGlobalCtx,
          'invest_open_option_tickers_for_org',
          [ctx.organizationId]
        )
      : await this.gateway.readQuery(optionMarketGlobalCtx, 'invest_open_option_tickers', []);
    const underlyings = new Set<string>();
    for (const row of rows) {
      const ticker = String(row.ticker ?? '').toUpperCase();
      if (!ticker || !isOptionTicker(ticker)) continue;
      underlyings.add(inferUnderlyingTicker(ticker));
    }
    return [...underlyings].sort();
  }

  async syncFromOpcoesNet(
    ctx: UserContext,
    options?: { underlyings?: string[]; asOfDate?: string; delayMs?: number; reuseSessionCache?: boolean }
  ): Promise<OptionMarketSyncReport> {
    const underlyings =
      options?.underlyings?.length
        ? options.underlyings.map((u) => u.trim().toUpperCase())
        : await this.listUnderlyingsWithOptionsInUse(ctx);

    const asOfDate = options?.asOfDate ?? new Date().toISOString().slice(0, 10);
    const delayMs = options?.delayMs ?? 400;
    const cacheKey = options?.reuseSessionCache ? optionMarketCacheKey(ctx, underlyings) : null;
    if (cacheKey) {
      const cached = optionMarketRunCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          inserted: 0,
          updated: 0,
          cacheHit: true,
        };
      }
    }

    let rowsParsed = 0;
    let inserted = 0;
    let updated = 0;
    const errors: OptionMarketSyncReport['errors'] = [];

    for (const underlying of underlyings) {
      try {
        const expirations = await fetchOpcoesNetOptionsChainAll(underlying);
        const parsed = parseOpcoesNetExpirations(underlying, expirations, asOfDate);
        rowsParsed += parsed.length;
        const result = await this.marketRepo.upsertMany(optionMarketGlobalCtx, parsed);
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

    const report = { underlyings, rowsParsed, inserted, updated, errors, cacheHit: false };
    if (cacheKey && errors.length === 0) {
      optionMarketRunCache.set(cacheKey, report);
    }
    return report;
  }
}
