import { InvestCashAccountPolicy } from '../../../src/core/invest/InvestCashAccountPolicy';
import { InMemoryGateway } from '../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../src/core/dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal/types';

describe('InvestCashAccountPolicy', () => {
  let gateway: InMemoryGateway;
  let policy: InvestCashAccountPolicy;

  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: 'org-cash-test',
    impersonatorId: null,
    scope: 'node',
  };

  beforeEach(() => {
    gateway = new InMemoryGateway();
    policy = new InvestCashAccountPolicy(gateway as any);
  });

  it('fails loud with INVEST_CASH_ACCOUNT_POLICY_NOT_FOUND when policy is missing', async () => {
    await expect(policy.resolve(ctx, { brokerCode: 'UNKNOWN' })).rejects.toThrow(/Nenhuma policy de caixa encontrada/);
  });

  it('usa default transicional BTG/BRL quando a policy ainda nao foi semeada', async () => {
    const result = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(result.policyId).toBe('icap-btg-brl-default');
    expect(result.cashTicker).toBe('CAIXA-BTG');
    expect(result.financialAccountExternalId).toBe('BTG');
  });

  it('regressao producao: schema ausente de policy nao bloqueia BTG/BRL', async () => {
    const missingSchemaGateway = {
      findWhere: jest.fn().mockRejectedValue({ code: 'ER_NO_SUCH_TABLE', errno: 1146 }),
    };
    const service = new InvestCashAccountPolicy(missingSchemaGateway as any);

    const result = await service.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });

    expect(result.policyId).toBe('icap-btg-brl-default');
    expect(result.cashTicker).toBe('CAIXA-BTG');
  });

  it('resolves default policy for currency correctly', async () => {
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'icap-btg-brl-default',
      org_id: ctx.organizationId,
      broker_code: 'BTG',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-BTG',
      cash_name: 'BTG Pactual',
      financial_account_type: 'brokerage',
      financial_account_external_id: 'BTG-BRL',
      is_default_for_currency: 1,
      is_active: 1,
      valid_from: '1900-01-01'
    });

    const result = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(result.cashTicker).toBe('CAIXA-BTG');
    expect(result.brokerCode).toBe('BTG');
  });

  it('resolves policy based on priority order: source_system match over default', async () => {
    // Default BRL
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'default-brl',
      org_id: ctx.organizationId,
      broker_code: 'XP',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-XP',
      is_default_for_currency: 1,
      is_active: 1,
      valid_from: '1900-01-01'
    });

    // Specific source system BRL
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'specific-brl',
      org_id: ctx.organizationId,
      broker_code: 'XP',
      source_system: 'SMART_BRAIN',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-XP-SB',
      is_default_for_currency: 0,
      is_active: 1,
      valid_from: '1900-01-01'
    });

    // Request without source system -> matches default
    const r1 = await policy.resolve(ctx, { brokerCode: 'XP', currencyCode: 'BRL' });
    expect(r1.cashTicker).toBe('CAIXA-XP');

    // Request with source system -> matches specific
    const r2 = await policy.resolve(ctx, { brokerCode: 'XP', currencyCode: 'BRL', sourceSystem: 'SMART_BRAIN' });
    expect(r2.cashTicker).toBe('CAIXA-XP-SB');
  });

  it('returns financialAccountId if binding exists', async () => {
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'policy-with-binding',
      org_id: ctx.organizationId,
      broker_code: 'BTG',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-BTG',
      is_active: 1,
      valid_from: '1900-01-01'
    });

    const insertSpy = jest.spyOn(gateway, 'insert');

    await policy.bindFinancialAccount(ctx, {
      policyId: 'policy-with-binding',
      financialAccountId: 'fin-acc-123',
      cashTicker: 'CAIXA-BTG',
      currencyCode: 'BRL'
    });

    const bindings = await gateway.findWhere(ctx, 'invest_cash_account_bindings', {
      policy_id: 'policy-with-binding',
      organization_id: ctx.organizationId,
    });
    const result = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });
    const bindingInsert = insertSpy.mock.calls.find((call) => call[1] === 'invest_cash_account_bindings');
    expect(bindingInsert?.[2]).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(bindings[0]?.id).toEqual(expect.any(String));
    expect(String(bindings[0]?.id)).toHaveLength(36);
    expect(result.financialAccountId).toBe('fin-acc-123');
  });

  it('respects valid_from and valid_to dates', async () => {
    // Old policy
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'policy-old',
      org_id: ctx.organizationId,
      broker_code: 'BTG',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-BTG-OLD',
      is_active: 1,
      valid_from: '2020-01-01',
      valid_to: '2025-12-31'
    });

    // New policy
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'policy-new',
      org_id: ctx.organizationId,
      broker_code: 'BTG',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-BTG-NEW',
      is_active: 1,
      valid_from: '2026-01-01'
    });

    const r1 = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL', eventDate: '2024-06-01' });
    expect(r1.cashTicker).toBe('CAIXA-BTG-OLD');

    const r2 = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL', eventDate: '2026-06-01' });
    expect(r2.cashTicker).toBe('CAIXA-BTG-NEW');
  });

  it('updates existing binding when binding again', async () => {
    await gateway.insert(ctx, 'invest_cash_account_policies', {
      id: 'policy-update-binding',
      org_id: ctx.organizationId,
      broker_code: 'BTG',
      currency_code: 'BRL',
      cash_ticker: 'CAIXA-BTG',
      is_active: 1,
      valid_from: '1900-01-01'
    });

    await policy.bindFinancialAccount(ctx, {
      policyId: 'policy-update-binding',
      financialAccountId: 'fin-acc-1',
      cashTicker: 'CAIXA-BTG',
      currencyCode: 'BRL'
    });

    let result = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(result.financialAccountId).toBe('fin-acc-1');

    // Bind again to update
    await policy.bindFinancialAccount(ctx, {
      policyId: 'policy-update-binding',
      financialAccountId: 'fin-acc-2',
      cashTicker: 'CAIXA-BTG',
      currencyCode: 'BRL'
    });

    result = await policy.resolve(ctx, { brokerCode: 'BTG', currencyCode: 'BRL' });
    expect(result.financialAccountId).toBe('fin-acc-2');
  });
});
