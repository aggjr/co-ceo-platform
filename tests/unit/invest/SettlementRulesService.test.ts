import { SettlementRulesService } from '../../../src/core/invest/SettlementRulesService';
import { InMemoryGateway } from '../core/business-events/inMemoryGateway';
import type { UserContext } from '../../../src/core/dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal/types';

describe('SettlementRulesService', () => {
  const nodeCtx: UserContext = {
    userId: SYSTEM_INSTALLER_USER_ID,
    organizationId: 'org-holding-001',
    impersonatorId: null,
    scope: 'node',
  };

  it('resolve regras de liquidacao com contexto de organizacao (catalogo global)', async () => {
    const gateway = new InMemoryGateway();
    const service = new SettlementRulesService(gateway as any);

    const rule = await service.resolveRule(
      {
        tradeDate: '2026-05-15',
        assetType: 'stock',
        transactionType: 'buy',
        ticker: 'PRIO3',
      },
      nodeCtx
    );

    expect(rule).not.toBeNull();
    expect(rule?.daysOffset).toBeGreaterThan(0);
  });

  it('usa fallback local quando tabela de regras ainda nao existe', async () => {
    const gateway = {
      readQuery: jest.fn().mockRejectedValue({ code: 'ER_NO_SUCH_TABLE', errno: 1146 }),
    };
    const service = new SettlementRulesService(gateway as any);

    const fixedIncomeRule = await service.resolveRule(
      {
        tradeDate: '2026-05-15',
        assetType: 'fixed_income',
        transactionType: 'buy',
        ticker: 'LFT-20310301',
      },
      nodeCtx
    );
    const equityRule = await service.resolveRule(
      {
        tradeDate: '2026-05-15',
        assetType: 'stock',
        transactionType: 'buy',
        ticker: 'PRIO3',
      },
      nodeCtx
    );

    expect(fixedIncomeRule?.ruleCode).toBe('TESOURO_D1');
    expect(fixedIncomeRule?.daysOffset).toBe(1);
    expect(equityRule?.ruleCode).toBe('B3_EQUITY_D2');
    expect(equityRule?.daysOffset).toBe(2);
  });
});
