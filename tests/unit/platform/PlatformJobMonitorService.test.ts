import { evaluateOptionsMarketSyncReport } from '../../../src/core/platform/PlatformJobMonitorService';
import type { OptionMarketSyncReport } from '../../../src/core/invest/OptionMarketSyncService';

describe('evaluateOptionsMarketSyncReport', () => {
  const base: OptionMarketSyncReport = {
    underlyings: ['PRIO3', 'ITUB4'],
    tickersInUse: ['PRIOA407'],
    rowsParsed: 100,
    rowsKept: 1,
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

  it('warning quando nenhuma linha do cliente foi mantida', () => {
    const o = evaluateOptionsMarketSyncReport({ ...base, rowsKept: 0 });
    expect(o.status).toBe('warning');
  });

  it('warning quando opcao aberta fica sem contrato/cotacao', () => {
    const o = evaluateOptionsMarketSyncReport({
      ...base,
      quoteSync: [
        {
          date: '2026-06-16',
          tickersInUse: ['PRIOX999'],
          quotesSaved: 0,
          missing: ['PRIOX999'],
          contractsInserted: 0,
          contractsUpdated: 0,
        },
      ],
    });
    expect(o.status).toBe('warning');
    expect(o.title).toMatch(/cotacoes faltantes/i);
  });

  it('nao gera warning quando contrato conhecido nao teve ultimo negocio', () => {
    const o = evaluateOptionsMarketSyncReport({
      ...base,
      quoteSync: [
        {
          date: '2026-06-16',
          tickersInUse: ['PRION415'],
          quotesSaved: 0,
          missing: [],
          unquotedKnownContracts: ['PRION415'],
          contractsInserted: 0,
          contractsUpdated: 0,
        },
      ],
    });
    expect(o.status).toBe('success');
    expect(o.body).toMatch(/Sem ultimo negocio/);
  });
});
