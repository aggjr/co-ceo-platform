import type { CoCeoDataGateway, UserContext } from '../../../src/core/dal';
import {
  PatrimonyMonthlyAnchorsSeedService,
  HOME_BROKER_ANCHOR_REFERENCE,
} from '../../../src/core/invest/PatrimonyMonthlyAnchorsSeedService';
import { HOLDING_ORG_ID } from '../../../src/core/invest/btgPatrimonyAnchorReference';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: HOLDING_ORG_ID,
  impersonatorId: null,
  scope: 'node',
};

function mockGateway(): CoCeoDataGateway {
  const store = new Map<string, Record<string, unknown>>();
  return {
    findWhere: jest.fn(async (_ctx, table, where) => {
      if (table !== 'invest_patrimony_monthly_anchors') return [];
      const date = String(where.reference_date ?? '');
      const hit = [...store.values()].find(
        (r) => r.reference_date === date && r.organization_id === ctx.organizationId
      );
      return hit ? [{ id: hit.id }] : [];
    }),
    insert: jest.fn(async (_ctx, table, payload) => {
      const id = String(payload.id);
      store.set(id, { ...payload, id });
    }),
    update: jest.fn(async (_ctx, _table, id, payload) => {
      const row = store.get(id);
      if (row) store.set(id, { ...row, ...payload });
    }),
    readQuery: jest.fn(),
    findById: jest.fn(),
    softDelete: jest.fn(),
    deleteMatching: jest.fn(),
    transaction: jest.fn(),
    getOrganizationStorage: jest.fn(),
    recordTelemetryEvents: jest.fn(),
  } as unknown as CoCeoDataGateway;
}

describe('PatrimonyMonthlyAnchorsSeedService', () => {
  it('grava fechamentos e aberturas homebroker via gateway', async () => {
    const gateway = mockGateway();
    const svc = new PatrimonyMonthlyAnchorsSeedService(gateway);

    const result = await svc.seedFromHomebrokerReference(ctx);

    expect(result.upserted).toBe(
      HOME_BROKER_ANCHOR_REFERENCE.month_ends.length + 1
    );
    expect(result.points.some((p) => p.date === '2026-01-31')).toBe(true);
    expect(result.points.some((p) => p.date === '2026-05-29')).toBe(true);
    expect(result.fixedIncomeTotal).toBe(HOME_BROKER_ANCHOR_REFERENCE.fixed_income_total);
    expect(gateway.insert).toHaveBeenCalled();
  });
});
