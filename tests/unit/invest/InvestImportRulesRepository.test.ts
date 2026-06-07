import { InvestImportRulesRepository } from '../../../src/core/invest/InvestImportRulesRepository';
import type { InvestImportRule } from '../../../src/core/invest/ledgerTypes';

const mockRules: InvestImportRule[] = [
  { rule_code: 'BTG_AMORT', broker_id: 'BTG', description_pattern: 'AMORT',
    mapped_operation: 'amortization', target_asset_type: 'fii', priority: 10 },
  { rule_code: 'BTG_LIQ',   broker_id: 'BTG', description_pattern: 'LIQ',
    mapped_operation: 'skip', priority: 20 },
  { rule_code: 'XP_AMORT',  broker_id: 'XP',  description_pattern: 'AMORT',
    mapped_operation: 'amortization', target_asset_type: 'fii', priority: 10 },
  { rule_code: 'ALL_IRRF',  broker_id: '*',   description_pattern: 'IRRF',
    mapped_operation: 'cost_adjustment', priority: 40 },
];

const mockCtx = {} as any;

describe('InvestImportRulesRepository', () => {
  it('filtra por broker_id e inclui universais (*)', async () => {
    const gw = { findWhere: jest.fn().mockResolvedValue(mockRules) };
    const repo = new InvestImportRulesRepository(gw as any);
    const rules = await repo.loadForBroker(mockCtx, 'BTG');
    const codes = rules.map((r) => r.rule_code);

    expect(codes).toContain('BTG_AMORT');
    expect(codes).toContain('BTG_LIQ');
    expect(codes).toContain('ALL_IRRF');  // broker_id = '*'
    expect(codes).not.toContain('XP_AMORT');
  });

  it('ordena por priority ASC', async () => {
    const gw = { findWhere: jest.fn().mockResolvedValue(mockRules) };
    const repo = new InvestImportRulesRepository(gw as any);
    const rules = await repo.loadForBroker(mockCtx, 'BTG');

    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].priority).toBeLessThanOrEqual(rules[i].priority);
    }
  });

  it('retorna lista vazia se tabela nao existe', async () => {
    const gw = { findWhere: jest.fn().mockRejectedValue(new Error('table missing')) };
    const repo = new InvestImportRulesRepository(gw as any);
    const rules = await repo.loadForBroker(mockCtx, 'BTG');
    expect(rules).toEqual([]);
  });

  it('cache evita consulta dupla ao banco', async () => {
    const gw = { findWhere: jest.fn().mockResolvedValue(mockRules) };
    const repo = new InvestImportRulesRepository(gw as any);
    await repo.loadForBroker(mockCtx, 'BTG');
    await repo.loadForBroker(mockCtx, 'XP');
    expect(gw.findWhere).toHaveBeenCalledTimes(1);
  });
});
