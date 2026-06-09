import { randomUUID } from 'crypto';
import type { CoCeoDataGateway, UserContext } from '../dal';
import { GatewayError } from '../dal/errors';
import { isMissingSchemaError } from '../dal/mysqlErrors';

export type InvestCashAccountResolutionInput = {
  organizationId: string;
  brokerCode?: string | null;
  sourceSystem?: string | null;
  currencyCode?: string | null;
  eventDate?: string | null;
};

export type InvestCashAccountPolicyRow = {
  id: string;
  organization_id: string | null;
  broker_code: string;
  source_system: string | null;
  currency_code: string;
  cash_ticker: string;
  cash_name: string;
  financial_account_external_id: string;
  financial_account_type: string;
  is_default_for_broker: boolean | number;
  is_default_for_currency: boolean | number;
  valid_from: string;
  valid_to: string | null;
  priority: number;
};

export type ResolvedInvestCashAccount = {
  policyId: string;
  brokerCode: string;
  currencyCode: string;
  cashTicker: string;
  cashName: string;
  financialAccountExternalId: string;
  financialAccountType: string;
  financialAccountId?: string;
};

export class InvestCashAccountPolicy {
  // Simple cache to avoid repeated queries for the same parameters within a run.
  private resolutionCache = new Map<string, ResolvedInvestCashAccount>();

  constructor(private readonly gateway: CoCeoDataGateway) {}

  /**
   * Mapa de normalização de nomes de broker para o código canônico.
   * Usado como fallback seguro antes de consultar a tabela invest_broker_aliases.
   * Adicione entradas aqui quando novos aliases forem identificados.
   */
  private static readonly BROKER_ALIAS_MAP: Record<string, string> = {
    'btg pactual':    'BTG',
    'btgpactual':     'BTG',
    'btg':            'BTG',
    'xp investimentos': 'XP',
    'xp':             'XP',
    'rico':           'RICO',
    'clear':          'CLEAR',
    'nuinvest':       'NUINVEST',
    'nu invest':      'NUINVEST',
    'inter':          'INTER',
    'banco inter':    'INTER',
  };

  private normalizeBrokerCode(raw?: string | null): string {
    if (!raw) return 'BTG';
    const normalized = InvestCashAccountPolicy.BROKER_ALIAS_MAP[raw.trim().toLowerCase()];
    return normalized ?? raw.trim();
  }

  async resolve(
    ctx: UserContext,
    input?: Partial<InvestCashAccountResolutionInput>
  ): Promise<ResolvedInvestCashAccount> {
    const orgId = input?.organizationId ?? ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_PAYLOAD', 'Organization ID is required to resolve cash account.', 400);
    }

    const brokerCode = this.normalizeBrokerCode(input?.brokerCode); // Normaliza alias antes de qualquer lookup
    const currencyCode = input?.currencyCode || 'BRL';
    const sourceSystem = input?.sourceSystem || null;
    const eventDate = input?.eventDate || new Date().toISOString().slice(0, 10);

    const cacheKey = `${orgId}:${brokerCode}:${currencyCode}:${sourceSystem ?? 'null'}:${eventDate}`;
    if (this.resolutionCache.has(cacheKey)) {
      return this.resolutionCache.get(cacheKey)!;
    }

    // Attempt to resolve policy using the priority order
    const policy = await this.queryPolicy(ctx, orgId, brokerCode, currencyCode, sourceSystem, eventDate);

    if (!policy) {
      const fallback = this.defaultPolicy(orgId, brokerCode, currencyCode);
      if (!fallback) {
        throw new GatewayError(
          'INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND',
          `Nenhuma policy de caixa encontrada para org=${orgId}, broker=${brokerCode}, currency=${currencyCode}.`,
          400
        );
      }
      this.resolutionCache.set(cacheKey, fallback);
      return fallback;
    }

    const resolved: ResolvedInvestCashAccount = {
      policyId: policy.id,
      brokerCode: policy.broker_code,
      currencyCode: policy.currency_code,
      cashTicker: policy.cash_ticker,
      cashName: policy.cash_name,
      financialAccountExternalId: policy.financial_account_external_id,
      financialAccountType: policy.financial_account_type,
    };

    // Try to find an existing binding
    let bindingRows: Array<{ financial_account_id?: unknown }> = [];
    try {
      bindingRows = await this.gateway.findWhere(ctx, 'invest_cash_account_bindings', {
        policy_id: policy.id,
        organization_id: orgId
      });
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    if (bindingRows.length > 0) {
      resolved.financialAccountId = String(bindingRows[0].financial_account_id);
    }

    this.resolutionCache.set(cacheKey, resolved);
    return resolved;
  }

  async bindFinancialAccount(
    ctx: UserContext,
    input: {
      policyId: string;
      financialAccountId: string;
      cashTicker: string;
      currencyCode: string;
    }
  ): Promise<void> {
    const orgId = ctx.organizationId;
    if (!orgId) {
      throw new GatewayError('INVALID_PAYLOAD', 'Organization ID required to bind account.', 400);
    }

    const existing = await this.gateway.findWhere(ctx, 'invest_cash_account_bindings', {
      policy_id: input.policyId,
      organization_id: orgId
    });

    if (existing.length > 0) {
      await this.gateway.update(ctx, 'invest_cash_account_bindings', String(existing[0].id), {
        financial_account_id: input.financialAccountId,
        cash_ticker: input.cashTicker,
        currency_code: input.currencyCode,
      });
    } else {
      await this.gateway.insert(ctx, 'invest_cash_account_bindings', {
        id: randomUUID(),
        policy_id: input.policyId,
        organization_id: orgId,
        financial_account_id: input.financialAccountId,
        cash_ticker: input.cashTicker,
        currency_code: input.currencyCode,
      });
    }

    this.clearCache();
  }

  clearCache(): void {
    this.resolutionCache.clear();
  }

  private defaultPolicy(
    orgId: string,
    brokerCode: string,
    currencyCode: string
  ): ResolvedInvestCashAccount | null {
    if (brokerCode !== 'BTG' || currencyCode !== 'BRL') return null;
    void orgId;
    return {
      policyId: 'icap-btg-brl-default',
      brokerCode: 'BTG',
      currencyCode: 'BRL',
      cashTicker: 'CAIXA-BTG',
      cashName: 'Conta Corrente BTG',
      financialAccountExternalId: 'BTG',
      financialAccountType: 'brokerage',
    };
  }

  private async queryPolicy(
    ctx: UserContext,
    orgId: string,
    brokerCode: string,
    currencyCode: string,
    sourceSystem: string | null,
    eventDate: string
  ): Promise<InvestCashAccountPolicyRow | null> {
    // We must find a policy that matches valid_from / valid_to
    // Ordering by:
    // 1. organization_id IS NOT NULL vs IS NULL
    // 2. Exact broker_code + source_system
    // 3. Exact broker_code
    // 4. Default for currency
    // 5. Priority (ASC)
    // 6. valid_from (DESC)
    
    // As doing complex order by in SQL is possible but could be tricky across default flags,
    // we fetch the candidates and sort them in code to strictly follow the requested priority.

    let allRows: InvestCashAccountPolicyRow[];
    try {
      allRows = await this.gateway.findWhere(ctx, 'invest_cash_account_policies', { is_active: 1 }) as InvestCashAccountPolicyRow[];
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
    const rows = allRows.filter(r => 
      (this.rowOrganizationId(r) === orgId || this.rowOrganizationId(r) === null) &&
      r.currency_code === currencyCode &&
      r.valid_from <= eventDate &&
      (!r.valid_to || r.valid_to >= eventDate)
    );

    if (rows.length === 0) return null;

    // Filter to valid candidates (must match broker/source or be a default)
    const candidates = rows.filter(r => {
      if (r.broker_code === brokerCode) {
        if (sourceSystem && r.source_system === sourceSystem) return true;
        if (!r.source_system) return true;
      }
      if (r.is_default_for_currency) return true;
      return false;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      // 1. Org specific vs global
      const aIsOrg = this.rowOrganizationId(a) === orgId;
      const bIsOrg = this.rowOrganizationId(b) === orgId;
      if (aIsOrg && !bIsOrg) return -1;
      if (!aIsOrg && bIsOrg) return 1;

      // 2. Exact broker & source system
      const aBrokerSrc = a.broker_code === brokerCode && a.source_system === sourceSystem;
      const bBrokerSrc = b.broker_code === brokerCode && b.source_system === sourceSystem;
      if (aBrokerSrc && !bBrokerSrc) return -1;
      if (!aBrokerSrc && bBrokerSrc) return 1;

      // 3. Exact broker
      const aBroker = a.broker_code === brokerCode;
      const bBroker = b.broker_code === brokerCode;
      if (aBroker && !bBroker) return -1;
      if (!aBroker && bBroker) return 1;

      // 4. Default for currency (if we get here, both are either defaults or somehow tied, should already be defaults if broker didn't match)
      const aDefaultCur = !!a.is_default_for_currency;
      const bDefaultCur = !!b.is_default_for_currency;
      if (aDefaultCur && !bDefaultCur) return -1;
      if (!aDefaultCur && bDefaultCur) return 1;

      // 5. Priority
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      // 6. valid_from (DESC)
      if (a.valid_from !== b.valid_from) {
        return a.valid_from > b.valid_from ? -1 : 1;
      }

      return 0;
    });

    return candidates[0];
  }

  private rowOrganizationId(row: InvestCashAccountPolicyRow): string | null {
    const raw = (row as InvestCashAccountPolicyRow & { org_id?: string | null }).organization_id ??
      (row as InvestCashAccountPolicyRow & { org_id?: string | null }).org_id ??
      null;
    return raw == null ? null : String(raw);
  }
}
