import { DailyCloseMaterializeService } from '../../../../src/core/invest/reconcile/DailyCloseMaterializeService';
import { GatewayError } from '../../../../src/core/dal/errors';
import type { CoCeoDataGateway } from '../../../../src/core/dal';
import type { RecordDailyPatrimonyResult } from '../../../../src/core/invest/PatrimonyDailyRecorder';
import type { StoredPortfolioDay } from '../../../../src/core/invest/PatrimonyDailyStore';

function makeService(): DailyCloseMaterializeService {
  return new DailyCloseMaterializeService({} as CoCeoDataGateway);
}

function makeResult(overrides: Partial<StoredPortfolioDay>, btgPatrimony: number | null): RecordDailyPatrimonyResult {
  const recorded: StoredPortfolioDay = {
    id: 'day-1',
    organization_id: 'org-holding-001',
    snapshot_date: '2026-04-17',
    patrimony: 1125,
    patrimony_gross: 1125,
    cash: 100,
    positions_value: 900,
    pending_settlements: 25,
    settled_cash: null,
    cash_in_transit: null,
    fixed_income_total: 100,
    external_flow: 0,
    daily_return_simple: null,
    daily_return_twr: null,
    cumulative_twr: null,
    quotes_as_of: '2026-04-17',
    source: 'mtm_btg_calibrated',
    metadata: null,
    ...overrides,
  };
  return {
    snapshotDate: '2026-04-17',
    recorded,
    positionsSaved: 0,
    quotesAsOf: '2026-04-17',
    economicPatrimony: recorded.patrimony,
    btgPatrimony,
  };
}

describe('DailyCloseMaterializeService patrimonio coherence', () => {
  it('aceita patrimonio igual a caixa + ativos + renda fixa + liquidacoes pendentes e ancora BTG', () => {
    const service = makeService() as unknown as {
      assertPatrimonyCoherent: (
        day: string,
        result: RecordDailyPatrimonyResult
      ) => {
        recordedPatrimony: number;
        componentsTotal: number;
        componentsDelta: number;
        anchorPatrimony: number | null;
        anchorDelta: number | null;
      };
    };

    const validation = service.assertPatrimonyCoherent(
      '2026-04-17',
      makeResult({}, 1125.25)
    );

    expect(validation).toEqual({
      recordedPatrimony: 1125,
      componentsTotal: 1125,
      componentsDelta: 0,
      anchorPatrimony: 1125.25,
      anchorDelta: -0.25,
    });
  });

  it('bloqueia fechamento quando componentes nao batem com patrimonio gravado', () => {
    const service = makeService() as unknown as {
      assertPatrimonyCoherent: (day: string, result: RecordDailyPatrimonyResult) => unknown;
    };

    expect(() =>
      service.assertPatrimonyCoherent(
        '2026-04-17',
        makeResult({ patrimony: 1100 }, 1100)
      )
    ).toThrow(GatewayError);
  });

  it('bloqueia fechamento quando patrimonio fica fora da ancora do homebroker', () => {
    const service = makeService() as unknown as {
      assertPatrimonyCoherent: (day: string, result: RecordDailyPatrimonyResult) => unknown;
    };

    expect(() =>
      service.assertPatrimonyCoherent(
        '2026-04-17',
        makeResult({}, 1200)
      )
    ).toThrow(GatewayError);
  });
});
