import { SettlementRulesService } from '../../../src/core/invest/SettlementRulesService';
import { addBusinessDays, isB3BusinessHoliday } from '../../../src/core/invest/settlementCalendar';
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

  it('regressao producao: ACCESS_DENIED em settlement_rule_candidates nao derruba purge/Option C', async () => {
    const gateway = {
      readQuery: jest.fn().mockRejectedValue({
        code: 'ACCESS_DENIED',
        message: 'Consulta restrita ao escopo global da plataforma.',
      }),
    };
    const service = new SettlementRulesService(gateway as any);

    const settlementDate = await service.resolveSettlementDate(
      {
        tradeDate: '2026-01-06',
        assetType: 'stock',
        transactionType: 'buy',
        ticker: 'PRIO3',
      },
      nodeCtx
    );

    expect(settlementDate).toBe('2026-01-08');
    expect(gateway.readQuery).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
      'settlement_rule_candidates',
      ['stock', 'buy', '2026-01-06', '2026-01-06']
    );
  });

  it('liquidacao B3 pula feriado nacional de 21/04', async () => {
    const gateway = new InMemoryGateway();
    const service = new SettlementRulesService(gateway as any);

    expect(isB3BusinessHoliday('2026-04-21')).toBe(true);
    expect(addBusinessDays('2026-04-17', 2)).toBe('2026-04-22');
    await expect(
      service.resolveSettlementDate(
        {
          tradeDate: '2026-04-17',
          assetType: 'stock',
          transactionType: 'buy',
          ticker: 'PRIO3',
        },
        nodeCtx
      )
    ).resolves.toBe('2026-04-22');
  });
});
