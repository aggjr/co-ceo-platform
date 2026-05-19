import { fetchB3Quotes } from '../../../src/core/invest/B3QuoteProvider';

describe('fetchB3Quotes', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('usa fechamento histórico quando asOfDate é informado', async () => {
    const closeDate = '2026-05-19';
    const unix = Math.floor(new Date(`${closeDate}T15:00:00Z`).getTime() / 1000);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            symbol: 'PRIO3',
            regularMarketPrice: 70,
            historicalDataPrice: [{ date: unix, close: 68.82 }],
          },
        ],
      }),
    }) as typeof fetch;

    const rows = await fetchB3Quotes(['PRIO3'], { asOfDate: closeDate, token: 'test' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBeCloseTo(68.82, 2);
    expect(rows[0]!.kind).toBe('close');
    expect(rows[0]!.asOf).toBe(closeDate);
  });
});
