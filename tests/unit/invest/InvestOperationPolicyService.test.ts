import { InvestOperationPolicyService } from '../../../src/core/invest/InvestOperationPolicyService';
import { InMemoryGateway } from '../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../src/core/dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal/types';

describe('InvestOperationPolicyService', () => {
  let gateway: InMemoryGateway;
  let service: InvestOperationPolicyService;

  const ctx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: 'org-test-01',
    impersonatorId: null,
    scope: 'node',
  };

  beforeEach(() => {
    gateway = new InMemoryGateway();
    service = new InvestOperationPolicyService(gateway as any);
  });

  it('fails loud when operation is unknown', async () => {
    await expect(service.requirePolicy(ctx, 'unknown_op')).rejects.toThrow(/Operação desconhecida/);
  });

  it('resolves base policy correctly with boolean conversion', async () => {
    await gateway.insert(ctx, 'invest_operation_policies', {
      operation_code: 'buy_test',
      business_event_kind: 'broker_note_spot',
      affects_portfolio: '1', // String 1 should become boolean true
      affects_financial: 0,   // Int 0 should become boolean false
      inventory_movement_type: 'acquisition',
      cash_direction: 'out',
      default_financial_status: 'cleared',
      uses_settlement_rules: true, // Boolean true
      requires_instrument: 1,
      requires_cash_account: 1,
      is_external_flow_for_twr: 0,
      is_trade: 1,
      is_option_trade: 0,
      is_corporate_action: 0,
      is_passive_income: 0,
      is_passive_expense: 0,
      is_opening: 0,
      is_active: 1
    });

    const policy = await service.requirePolicy(ctx, 'buy_test');
    expect(policy.operationCode).toBe('buy_test');
    expect(policy.affectsPortfolio).toBe(true);
    expect(policy.affectsFinancial).toBe(false);
    expect(policy.usesSettlementRules).toBe(true);
  });

  it('resolves overrides based on asset_type matching', async () => {
    await gateway.insert(ctx, 'invest_operation_policies', {
      operation_code: 'buy_base',
      business_event_kind: 'broker_note_spot',
      affects_portfolio: 1,
      affects_financial: 1,
      cash_direction: 'out',
      is_active: 1
    });

    // Valid override for 'fixed_income'
    await gateway.insert(ctx, 'invest_operation_asset_overrides', {
      operation_code: 'buy_base',
      asset_type: 'fixed_income',
      affects_financial: 0, // Override changes affects_financial to false
      valid_from: '2020-01-01',
      valid_to: null,
      priority: 10,
      is_active: 1
    });

    // Test without assetType
    const basePolicy = await service.requirePolicy(ctx, 'buy_base');
    expect(basePolicy.affectsFinancial).toBe(true);

    // Test with assetType matching override
    const overriddenPolicy = await service.resolve(ctx, { operationCode: 'buy_base', assetType: 'fixed_income', eventDate: '2026-06-01' });
    expect(overriddenPolicy).not.toBeNull();
    expect(overriddenPolicy!.affectsFinancial).toBe(false);

    // Test with assetType not matching override
    const stockPolicy = await service.resolve(ctx, { operationCode: 'buy_base', assetType: 'stock', eventDate: '2026-06-01' });
    expect(stockPolicy!.affectsFinancial).toBe(true);
  });

  it('respects valid_from and valid_to dates for overrides', async () => {
    await gateway.insert(ctx, 'invest_operation_policies', {
      operation_code: 'sell_test',
      business_event_kind: 'broker_note_spot',
      affects_portfolio: 1,
      is_active: 1
    });

    // Valid override from 2026-01-01 to 2026-12-31
    await gateway.insert(ctx, 'invest_operation_asset_overrides', {
      operation_code: 'sell_test',
      asset_type: 'stock',
      affects_portfolio: 0,
      valid_from: '2026-01-01',
      valid_to: '2026-12-31',
      priority: 10,
      is_active: 1
    });

    // Date before valid_from
    const before = await service.resolve(ctx, { operationCode: 'sell_test', assetType: 'stock', eventDate: '2025-12-31' });
    expect(before!.affectsPortfolio).toBe(true);

    // Date within range
    const within = await service.resolve(ctx, { operationCode: 'sell_test', assetType: 'stock', eventDate: '2026-06-01' });
    expect(within!.affectsPortfolio).toBe(false);

    // Date after valid_to
    const after = await service.resolve(ctx, { operationCode: 'sell_test', assetType: 'stock', eventDate: '2027-01-01' });
    expect(after!.affectsPortfolio).toBe(true);
  });

  it('loads cache only once and reuses it', async () => {
    await gateway.insert(ctx, 'invest_operation_policies', {
      operation_code: 'cache_test',
      business_event_kind: 'broker_note_spot',
      is_active: 1
    });

    // Initial load
    const p1 = await service.requirePolicy(ctx, 'cache_test');

    // Change DB directly (simulate direct write)
    await gateway.insert(ctx, 'invest_operation_policies', {
      operation_code: 'cache_test_2',
      business_event_kind: 'broker_note_spot',
      is_active: 1
    });

    // Should fail because cache is not reloaded
    await expect(service.requirePolicy(ctx, 'cache_test_2')).rejects.toThrow(/Operação desconhecida/);

    // Clear cache and try again
    service.clearCache();
    const p2 = await service.requirePolicy(ctx, 'cache_test_2');
    expect(p2).not.toBeNull();
  });
});
