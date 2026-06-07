import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import type { BusinessEventKind } from '../business-events';

export type InvestCashDirection = 'in' | 'out' | 'none' | 'signed';

export type InvestOperationPolicy = {
  operationCode: string;
  businessEventKind: BusinessEventKind;
  affectsPortfolio: boolean;
  affectsFinancial: boolean;
  inventoryMovementType: string | null;
  cashDirection: InvestCashDirection;
  defaultFinancialStatus: 'pending' | 'cleared';
  usesSettlementRules: boolean;
  requiresInstrument: boolean;
  requiresCashAccount: boolean;
  isExternalFlowForTwr: boolean;
  isTrade: boolean;
  isOptionTrade: boolean;
  isCorporateAction: boolean;
  isPassiveIncome: boolean;
  isPassiveExpense: boolean;
  isOpening: boolean;
  defaultPivotColumn: string | null;
};

type AssetOverride = Partial<Omit<InvestOperationPolicy, 'operationCode'>> & {
  assetType: string;
  validFrom: string;
  validTo: string | null;
  priority: number;
};

export class InvestOperationPolicyService {
  private cache: Map<string, { policy: InvestOperationPolicy; overrides: AssetOverride[] }> | null = null;

  constructor(private readonly gateway: CoCeoDataGateway) {}

  public clearCache(): void {
    this.cache = null;
  }

  private toBoolean(val: any): boolean {
    return val === true || val === 1 || val === '1';
  }

  private async loadCache(ctx: UserContext): Promise<void> {
    if (this.cache) return;
    
    this.cache = new Map();

    // Busca apenas políticas ativas (e de fato is_active pode estar retornado como int/buffer ou string do mysql2)
    const [policyRows, overrideRows] = await Promise.all([
      this.gateway.findWhere(ctx, 'invest_operation_policies', { is_active: 1 }),
      this.gateway.findWhere(ctx, 'invest_operation_asset_overrides', { is_active: 1 })
    ]);

    for (const row of policyRows) {
      const operationCode = String(row.operation_code);
      const policy: InvestOperationPolicy = {
        operationCode,
        businessEventKind: String(row.business_event_kind) as BusinessEventKind,
        affectsPortfolio: this.toBoolean(row.affects_portfolio),
        affectsFinancial: this.toBoolean(row.affects_financial),
        inventoryMovementType: row.inventory_movement_type ? String(row.inventory_movement_type) : null,
        cashDirection: String(row.cash_direction) as InvestCashDirection,
        defaultFinancialStatus: String(row.default_financial_status) as 'pending' | 'cleared',
        usesSettlementRules: this.toBoolean(row.uses_settlement_rules),
        requiresInstrument: this.toBoolean(row.requires_instrument),
        requiresCashAccount: this.toBoolean(row.requires_cash_account),
        isExternalFlowForTwr: this.toBoolean(row.is_external_flow_for_twr),
        isTrade: this.toBoolean(row.is_trade),
        isOptionTrade: this.toBoolean(row.is_option_trade),
        isCorporateAction: this.toBoolean(row.is_corporate_action),
        isPassiveIncome: this.toBoolean(row.is_passive_income),
        isPassiveExpense: this.toBoolean(row.is_passive_expense),
        isOpening: this.toBoolean(row.is_opening),
        defaultPivotColumn: row.default_pivot_column ? String(row.default_pivot_column) : null,
      };
      this.cache.set(operationCode, { policy, overrides: [] });
    }

    for (const row of overrideRows) {
      const operationCode = String(row.operation_code);
      const cached = this.cache.get(operationCode);
      if (!cached) continue; // Only load overrides for active policies

      const override: AssetOverride = {
        assetType: String(row.asset_type),
        validFrom: String(row.valid_from).slice(0, 10), // Ensures ISO date format
        validTo: row.valid_to ? String(row.valid_to).slice(0, 10) : null,
        priority: Number(row.priority),
      };

      if (row.affects_portfolio !== null) override.affectsPortfolio = this.toBoolean(row.affects_portfolio);
      if (row.affects_financial !== null) override.affectsFinancial = this.toBoolean(row.affects_financial);
      if (row.inventory_movement_type !== null) override.inventoryMovementType = String(row.inventory_movement_type);
      if (row.cash_direction !== null) override.cashDirection = String(row.cash_direction) as InvestCashDirection;
      if (row.default_financial_status !== null) override.defaultFinancialStatus = String(row.default_financial_status) as 'pending' | 'cleared';
      if (row.uses_settlement_rules !== null) override.usesSettlementRules = this.toBoolean(row.uses_settlement_rules);
      if (row.requires_instrument !== null) override.requiresInstrument = this.toBoolean(row.requires_instrument);
      if (row.requires_cash_account !== null) override.requiresCashAccount = this.toBoolean(row.requires_cash_account);
      if (row.is_external_flow_for_twr !== null) override.isExternalFlowForTwr = this.toBoolean(row.is_external_flow_for_twr);

      cached.overrides.push(override);
    }
  }

  async resolve(
    ctx: UserContext,
    input: {
      operationCode: string;
      assetType?: string | null;
      eventDate?: string | null;
    }
  ): Promise<InvestOperationPolicy> {
    await this.loadCache(ctx);
    const cached = this.cache!.get(input.operationCode);

    if (!cached) {
      throw new GatewayError('UNKNOWN_INVEST_OPERATION', `Operação desconhecida: ${input.operationCode}`, 400);
    }

    const { policy, overrides } = cached;

    if (!input.assetType || overrides.length === 0) {
      return { ...policy };
    }

    const eventDate = input.eventDate ? input.eventDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const validOverrides = overrides.filter(o => 
      o.assetType === input.assetType &&
      o.validFrom <= eventDate &&
      (!o.validTo || o.validTo >= eventDate)
    );

    if (validOverrides.length === 0) {
      return { ...policy };
    }

    // Sort by priority (asc), then validFrom (desc)
    validOverrides.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.validFrom.localeCompare(a.validFrom);
    });

    const activeOverride = validOverrides[0];

    const result = { ...policy };
    for (const key of Object.keys(activeOverride) as Array<keyof AssetOverride>) {
      if (
        key !== 'assetType' && 
        key !== 'validFrom' && 
        key !== 'validTo' && 
        key !== 'priority' && 
        activeOverride[key as keyof AssetOverride] !== undefined
      ) {
        (result as any)[key] = activeOverride[key as keyof AssetOverride];
      }
    }

    return result;
  }

  async requirePolicy(
    ctx: UserContext,
    operationCode: string
  ): Promise<InvestOperationPolicy> {
    return this.resolve(ctx, { operationCode });
  }
}
