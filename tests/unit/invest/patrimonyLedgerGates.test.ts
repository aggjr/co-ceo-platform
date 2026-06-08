import { buildDailyPatrimonyMtmSeries } from '../../../src/core/invest/PatrimonyMtmDailyEngine';
import {
  fixedIncomeTotalFromLedger,
  shouldUseBtgAnchorCalibration,
} from '../../../src/core/invest/patrimonyLedgerGates';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';
import type { InvestOperationPolicyService } from '../../../src/core/invest/InvestOperationPolicyService';
import type { UserContext } from '../../../src/core/dal/types';
import { SYSTEM_INSTALLER_USER_ID } from '../../../src/core/dal/types';

const ctx: UserContext = {
  userId: SYSTEM_INSTALLER_USER_ID,
  organizationId: 'org-test',
  impersonatorId: null,
  scope: 'node',
};

const mockPolicyService = {
  requirePolicy: async (c: any, type: string) => {
    return {
      affectsPortfolio: type === 'opening_balance' || type === 'buy' || type === 'sell'
    };
  }
} as unknown as InvestOperationPolicyService;

const anchors = {
  month_ends: [
    { date: '2025-12-31', patrimony: 1_224_319 },
    { date: '2026-05-31', patrimony: 1_509_811 },
  ],
  fixed_income_total: 208_292.9,
};

describe('patrimonyLedgerGates', () => {
  it('livro vazio não calibra às âncoras BTG', async () => {
    expect(await shouldUseBtgAnchorCalibration(ctx, [], mockPolicyService)).toBe(false);
    const r = buildDailyPatrimonyMtmSeries([], '2026-01-01', '2026-01-05', {
      anchors,
      fixedIncomeTotal: 0,
      calibrateToAnchors: false,
    });
    for (const p of r.series) {
      expect(p.patrimony).toBe(0);
    }
  });

  it('com abertura de ação permite calibração BTG', async () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 's1',
        asset_ticker: 'PRIO3',
        asset_type: 'stock',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 100,
        unit_price: 40,
        total_net_value: -4000,
        impacts_managerial_price: true,
      },
    ];
    expect(await shouldUseBtgAnchorCalibration(ctx, entries, mockPolicyService)).toBe(true);
  });

  it('RF soma aberturas do livro', () => {
    const entries: LedgerEvent[] = [
      {
        asset_id: 'rf1',
        asset_ticker: 'TESOURO-SELIC-2031',
        asset_type: 'fixed_income',
        transaction_type: 'opening_balance',
        transaction_date: '2026-01-01',
        quantity: 10,
        unit_price: 1000,
        total_net_value: -10000,
        impacts_managerial_price: true,
      },
    ];
    expect(fixedIncomeTotalFromLedger(entries)).toBe(10000);
  });
});
