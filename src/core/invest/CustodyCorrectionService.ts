import type { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import {
  BTG_CASH_STATEMENT_BALANCE_2026_05_19,
  cashBalanceFromLedger,
} from './cashInvestLedger';
import { btgExtractMay182026NetCash } from './btgExtractMay182026';
import {
  AUTHORIZED_GHOST_ASSET_TICKERS,
  BTG_STATEMENT_IMPORT_LINES,
  isGhostAssetTicker,
  isObsoleteCorrectionRef,
} from './custodyCorrections';
import type { LedgerImportService } from './LedgerImportService';

export type CustodyCorrectionResult = {
  purgedAssets: string[];
  removedObsoleteEntries: number;
  importedEntries: number;
  extractNetCash: number;
  reconcile: Awaited<ReturnType<LedgerImportService['reconcileCustody']>>;
};

export class CustodyCorrectionService {
  constructor(
    private readonly gateway: CoCeoDataGateway,
    private readonly ledger: LedgerImportService
  ) {}

  async applyAuthorizedCorrections(ctx: UserContext): Promise<CustodyCorrectionResult> {
    if (!ctx.organizationId) {
      throw new GatewayError('INVALID_CONTEXT', 'Organização obrigatória.', 400);
    }

    const purgedAssets: string[] = [];
    for (const ticker of AUTHORIZED_GHOST_ASSET_TICKERS) {
      const n = await this.purgeAsset(ctx, ticker);
      if (n) purgedAssets.push(ticker);
    }

    const removedObsoleteEntries = await this.removeObsoleteCorrectionEntries(ctx);

    const importResult = await this.ledger.importEntriesOnly(ctx, BTG_STATEMENT_IMPORT_LINES, {
      sourceLabel: 'Extrato BTG 18–19/05/2026',
    });

    await this.syncCashStatementBalance(ctx);

    return {
      purgedAssets,
      removedObsoleteEntries,
      importedEntries: importResult.inserted,
      extractNetCash: btgExtractMay182026NetCash(),
      reconcile: importResult.reconcile,
    };
  }

  async purgeAsset(ctx: UserContext, ticker: string): Promise<boolean> {
    if (!isGhostAssetTicker(ticker)) {
      throw new GatewayError(
        'INVALID_PAYLOAD',
        `Ticker não autorizado para purge: ${ticker}`,
        400
      );
    }
    const key = ticker.trim().toUpperCase();
    const rows = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: ctx.organizationId,
      asset_ticker: key,
    });
    const row = rows[0];
    if (!row?.id) return false;

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
    meta.purged_at = new Date().toISOString().slice(0, 10);
    meta.purge_reason =
      'Ativo inexistente — vendido há anos; removido da custódia com autorização do titular.';

    await this.gateway.update(ctx, 'invest_assets', String(row.id), {
      current_quantity: 0,
      managerial_avg_price: 0,
      status: 'liquidated',
      metadata: JSON.stringify(meta),
    });

    try {
      await this.gateway.delete(ctx, 'invest_assets', String(row.id));
    } catch {
      /* liquidated basta */
    }

    return true;
  }

  /** Remove lançamentos de correções anteriores que não batem com o extrato. */
  async removeObsoleteCorrectionEntries(ctx: UserContext): Promise<number> {
    const events = await this.ledger.listLedgerEvents(ctx, '2026-01-01', '2026-12-31');
    let n = 0;
    for (const e of events) {
      if (!e.id) continue;
      const ref = e.broker_note_ref ? String(e.broker_note_ref) : '';
      if (!isObsoleteCorrectionRef(ref)) continue;
      try {
        await this.gateway.delete(ctx, 'invest_ledger_entries', e.id);
        n += 1;
      } catch {
        await this.gateway.update(ctx, 'invest_ledger_entries', e.id, {
          impacts_managerial_price: false,
          notes: `${e.notes || ''} [substituído por extrato BTG 18–19/05]`.trim(),
        });
        n += 1;
      }
    }
    return n;
  }

  /** Grava saldo de caixa conferido com extrato 19/05/2026. */
  async syncCashStatementBalance(ctx: UserContext): Promise<void> {
    const rows = await this.gateway.findWhere(ctx, 'invest_assets', {
      organization_id: ctx.organizationId,
      asset_ticker: 'CAIXA-BTG',
    });
    const row = rows[0];
    if (!row?.id) return;

    const events = await this.ledger.listLedgerEvents(ctx, '2000-01-01', '2026-12-31');
    const fromLedger = cashBalanceFromLedger(events, '2026-05-19');
    const balance =
      fromLedger > 0 && fromLedger <= 15_000
        ? fromLedger
        : BTG_CASH_STATEMENT_BALANCE_2026_05_19;

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
    meta.statement_balance = balance;
    meta.statement_as_of = '2026-05-19';

    await this.gateway.update(ctx, 'invest_assets', String(row.id), {
      current_quantity: balance,
      managerial_avg_price: 1,
      metadata: JSON.stringify(meta),
      status: 'active',
    });
  }
}
