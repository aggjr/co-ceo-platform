import {
  buildPatrimonyAnchorDivergenceLine,
  PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE,
  PATRIMONY_DIVERGENCE_TICKER,
} from '../../../src/core/invest/PatrimonyAnchorDivergenceService';
import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';

describe('PatrimonyAnchorDivergenceService', () => {
  it('gera linha quando economico diverge da ancora', () => {
    const line = buildPatrimonyAnchorDivergenceLine('2026-01-31', 1_000_000, 1_100_000);
    expect(line).not.toBeNull();
    expect(line!.operation).toBe('patrimony_anchor_divergence');
    expect(line!.ticker).toBe(PATRIMONY_DIVERGENCE_TICKER);
    expect(line!.total_net_value).toBeCloseTo(-100_000, 0);
    expect(inferBusinessEventKind(line!, 'cash_movement')).toBe('unknown_invest_event');
  });

  it('nao gera linha dentro da tolerancia', () => {
    expect(
      buildPatrimonyAnchorDivergenceLine(
        '2026-01-31',
        1_000_000,
        1_000_000 + PATRIMONY_ANCHOR_DIVERGENCE_TOLERANCE
      )
    ).toBeNull();
  });
});
