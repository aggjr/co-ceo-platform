import { describe, it, expect } from '@jest/globals';
import {
  classifyExposureBand,
  buildExposureByUnderlying,
} from '../../../frontend/src/lib/optionExposureTables.js';

describe('optionExposureTables', () => {
  const putOtmNear = {
    underlying: 'PRIO3',
    optionStrike: 100,
    underlyingLastPrice: 103,
    quantity: -1000,
    optionType: 'put',
  };

  const putItm = {
    underlying: 'PRIO3',
    optionStrike: 100,
    underlyingLastPrice: 95,
    quantity: -500,
    optionType: 'put',
  };

  it('classifica PUT ITM e faixa acima do strike', () => {
    expect(classifyExposureBand(putItm, 'put', 5, 10)).toBe('itm');
    expect(classifyExposureBand(putOtmNear, 'put', 5, 10)).toBe('bandNear');
  });

  it('agrega notional por ativo', () => {
    const { lines, totals } = buildExposureByUnderlying([putItm, putOtmNear], 'put', 5, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0].underlying).toBe('PRIO3');
    expect(lines[0].itm).toBe(500 * 100);
    expect(lines[0].bandNear).toBe(1000 * 100);
    expect(lines[0].total).toBe(150000);
    expect(totals.total).toBe(150000);
  });
});
