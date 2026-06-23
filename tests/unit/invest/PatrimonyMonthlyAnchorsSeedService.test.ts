import type { CoCeoDataGateway, UserContext } from '../../../src/core/dal';
import {
  PatrimonyMonthlyAnchorsSeedService,
} from '../../../src/core/invest/PatrimonyMonthlyAnchorsSeedService';
import { normalizePatrimonyAnchorInput } from '../../../src/core/invest/patrimonyAnchors';

const ctx: UserContext = {
  userId: 'u1',
  organizationId: 'org-sample',
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
  it('normaliza JSON mensal simples do homebroker para aberturas e fechamentos', async () => {
    const gateway = mockGateway();
    const svc = new PatrimonyMonthlyAnchorsSeedService(gateway);
    const anchors = normalizePatrimonyAnchorInput([
      {
        mes: '2026-01',
        patrimonio_inicial: 1212435.41,
        rendimentos: 108045.81,
        aportes_retiradas: 18.0,
        impostos: 0.0,
        patrimonio_final: 1320481.6,
      },
      {
        mes: '2026-02',
        patrimonio_inicial: 1320481.6,
        rendimentos: 23173.38,
        aportes_retiradas: -10050.55,
        impostos: 0.0,
        patrimonio_final: 1333604.43,
      },
    ]);

    expect(anchors?.month_ends).toEqual([
      { date: '2026-01-01', patrimony: 1212435.41 },
      { date: '2026-01-31', patrimony: 1320481.6 },
      { date: '2026-02-01', patrimony: 1320481.6 },
      { date: '2026-02-28', patrimony: 1333604.43 },
    ]);

    const result = await svc.seedFromFile(ctx, anchors!);

    expect(result.upserted).toBe(4);
    expect(result.points.map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-31',
      '2026-02-01',
      '2026-02-28',
    ]);
  });
});
