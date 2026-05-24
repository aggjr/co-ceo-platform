import { HOLDING_BTG_PATRIMONY_ANCHORS } from '../../../src/core/invest/btgPatrimonyAnchorReference';
import { buildBtgInterpolatedPatrimonySeries } from '../../../src/core/invest/btgPatrimonySeries';

describe('buildBtgInterpolatedPatrimonySeries', () => {
  it('começa perto de 1,22M em 01/01/2026', () => {
    const series = buildBtgInterpolatedPatrimonySeries(
      '2026-01-01',
      '2026-01-31',
      HOLDING_BTG_PATRIMONY_ANCHORS
    );
    const jan1 = series.find((p) => p.date === '2026-01-01');
    expect(jan1?.patrimony).toBeGreaterThan(1_220_000);
    expect(jan1?.patrimony).toBeLessThan(1_230_000);
  });

  it('bate âncora de 31/01/2026', () => {
    const series = buildBtgInterpolatedPatrimonySeries(
      '2026-01-01',
      '2026-01-31',
      HOLDING_BTG_PATRIMONY_ANCHORS
    );
    const jan31 = series.find((p) => p.date === '2026-01-31');
    expect(jan31?.patrimony).toBeCloseTo(1_324_490, 0);
  });
});
