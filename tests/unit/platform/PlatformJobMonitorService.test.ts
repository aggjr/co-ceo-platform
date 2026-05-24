import { evaluateOptionsMarketSyncReport } from '../../../src/core/platform/PlatformJobMonitorService';
import type { OptionMarketSyncReport } from '../../../src/core/invest/OptionMarketSyncService';

describe('evaluateOptionsMarketSyncReport', () => {
  const base: OptionMarketSyncReport = {
    underlyings: ['PRIO3', 'ITUB4'],
    rowsParsed: 100,
    inserted: 10,
    updated: 90,
    errors: [],
  };

  it('success quando sem erros e com linhas', () => {
    const o = evaluateOptionsMarketSyncReport(base);
    expect(o.status).toBe('success');
  });

  it('error quando há falha por underlying', () => {
    const o = evaluateOptionsMarketSyncReport({
      ...base,
      errors: [{ underlying: 'WEGE3', message: 'HTTP 500' }],
    });
    expect(o.status).toBe('error');
    expect(o.title).toMatch(/falhas/i);
  });

  it('warning quando nenhuma linha parseada', () => {
    const o = evaluateOptionsMarketSyncReport({ ...base, rowsParsed: 0 });
    expect(o.status).toBe('warning');
  });
});
