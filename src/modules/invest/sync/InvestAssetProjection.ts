import type { CoCeoDataGateway, UserContext } from '../../../core/dal';
import { SYSTEM_INSTALLER_USER_ID } from '../../../core/dal/types';

export type InvestAssetRow = {
  id: string;
  organization_id: string;
  asset_ticker: string;
  asset_type: string;
  status: string;
  current_quantity: number;
  managerial_avg_price: number;
  metadata: string | null;
};

type Row = Record<string, unknown>;

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Projeta patrimony_items + invest_position_ext + invest_option_ext +
 * financial_accounts no shape que os consumers antigos esperavam de
 * invest_assets. Mantem retrocompatibilidade com InvestController,
 * PatrimonyDailyRecorder, CockpitController etc. sem reescrever as views.
 *
 * Esta projecao desaparece quando os consumers forem migrados para ler
 * patrimony_items / invest_position_ext diretamente.
 */
export class InvestAssetProjection {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Retorna todos os ativos (acoes, opcoes, RF) + cada conta de caixa como
   * uma linha sintetica CAIXA-<external_id>. Compativel com filtro
   * { organization_id, status: 'active' }.
   */
  async listActiveAssets(ctx: UserContext): Promise<InvestAssetRow[]> {
    const orgId = ctx.organizationId;
    if (!orgId) return [];

    const installer: UserContext = {
      userId: SYSTEM_INSTALLER_USER_ID,
      organizationId: orgId,
      impersonatorId: null,
      scope: 'global',
    };

    const items = await this.gateway.findWhere(installer, 'patrimony_items', {
      organization_id: orgId,
      source_module: 'INVEST',
    });
    const exts = await this.gateway.findWhere(installer, 'invest_position_ext', {
      organization_id: orgId,
    });
    const optionExts = await this.gateway.findWhere(installer, 'invest_option_ext', {
      organization_id: orgId,
    });
    const accounts = await this.gateway.findWhere(installer, 'financial_accounts', {
      organization_id: orgId,
      source_module: 'INVEST',
    });

    const extByItem = new Map<string, Row>();
    for (const ext of exts) extByItem.set(String(ext.patrimony_item_id), ext);
    const optionExtByItem = new Map<string, Row>();
    for (const o of optionExts) optionExtByItem.set(String(o.patrimony_item_id), o);

    const rows: InvestAssetRow[] = [];

    for (const item of items) {
      const itemId = String(item.id);
      const status = String(item.status ?? 'active');
      if (status !== 'active') continue;
      const ticker = String(item.identifier ?? '').toUpperCase();
      if (!ticker) continue;
      const ext = extByItem.get(itemId);
      const optionExt = optionExtByItem.get(itemId);
      const subcategory = String(item.subcategory ?? '');
      const assetType = ext ? String(ext.asset_class ?? subcategory) : subcategory;

      const meta: Record<string, unknown> = {};
      if (ext) {
        if (ext.last_price != null) meta.last_price = Number(ext.last_price);
        if (ext.last_price_as_of) meta.quote_as_of = String(ext.last_price_as_of).slice(0, 10);
        if (ext.underlying_ticker) meta.underlying_ticker = String(ext.underlying_ticker);
        if (ext.sector) meta.sector = String(ext.sector);
        if (ext.issuer_name) meta.name = String(ext.issuer_name);
      }
      if (optionExt) {
        if (optionExt.strike_price != null) meta.option_strike = Number(optionExt.strike_price);
        if (optionExt.expiration_date) meta.option_expiration = String(optionExt.expiration_date).slice(0, 10);
      }
      const itemMeta = parseMetadata(item.metadata);
      for (const k of Object.keys(itemMeta)) {
        if (meta[k] === undefined) meta[k] = itemMeta[k];
      }

      rows.push({
        id: itemId,
        organization_id: orgId,
        asset_ticker: ticker,
        asset_type: assetType,
        status,
        current_quantity: Number(item.quantity ?? 0),
        managerial_avg_price: ext?.pm_gerencial != null
          ? Number(ext.pm_gerencial)
          : Number(item.current_value ?? 0) / Math.max(Number(item.quantity ?? 1), 1),
        metadata: Object.keys(meta).length ? JSON.stringify(meta) : null,
      });
    }

    for (const acc of accounts) {
      const status = String(acc.status ?? 'active');
      if (status !== 'active') continue;
      const external = String(acc.external_id ?? 'CASH').toUpperCase();
      const ticker = `CAIXA-${external}`;
      const balance = Number(acc.opening_balance ?? 0);
      const meta: Record<string, unknown> = {
        broker_code: external,
        account_name: acc.name ?? null,
      };
      rows.push({
        id: String(acc.id),
        organization_id: orgId,
        asset_ticker: ticker,
        asset_type: 'cash',
        status,
        current_quantity: balance,
        managerial_avg_price: 1,
        metadata: JSON.stringify(meta),
      });
    }

    return rows;
  }

  /** Resolve uma linha pelo ticker (usado por updates de last_price etc). */
  async findByTicker(
    ctx: UserContext,
    ticker: string
  ): Promise<InvestAssetRow | null> {
    const upper = String(ticker || '').toUpperCase();
    const all = await this.listActiveAssets(ctx);
    return all.find((r) => r.asset_ticker === upper) ?? null;
  }
}
