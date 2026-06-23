import { SAMPLE_PATRIMONY_ANCHORS } from '../../fixtures/patrimonyAnchorsSample';
import { buildBtgInterpolatedPatrimonySeries } from '../../../src/core/invest/btgPatrimonySeries';

describe('buildBtgInterpolatedPatrimonySeries', () => {
  it('começa em 01/01/2026 no patrimônio de fechamento dez/2025 (app BTG)', () => {
    const series = buildBtgInterpolatedPatrimonySeries(
      '2026-01-01',
      '2026-01-31',
      SAMPLE_PATRIMONY_ANCHORS
    );
    const jan1 = series.find((p) => p.date === '2026-01-01');
    expect(jan1?.patrimony).toBeCloseTo(1_212_435.41, 0);
  });

  it('bate âncora de 31/01/2026 (app BTG)', () => {
    const series = buildBtgInterpolatedPatrimonySeries(
      '2026-01-01',
      '2026-01-31',
      SAMPLE_PATRIMONY_ANCHORS
    );
    const jan31 = series.find((p) => p.date === '2026-01-31');
    expect(jan31?.patrimony).toBeCloseTo(1_320_481.6, 0);
  });
});
