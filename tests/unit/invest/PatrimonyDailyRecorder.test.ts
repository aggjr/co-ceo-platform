import { PatrimonyDailyRecorder } from '../../../src/core/invest/PatrimonyDailyRecorder';
import type { CoCeoDataGateway } from '../../../src/core/dal';

describe('PatrimonyDailyRecorder quote requirements', () => {
  it('exige cotacao diaria exata para acoes, mas permite estimativa para renda fixa e opcoes', () => {
    const recorder = new PatrimonyDailyRecorder({} as CoCeoDataGateway) as unknown as {
      requiresExactDailyQuote: (assetType: string, ticker: string) => boolean;
    };

    expect(recorder.requiresExactDailyQuote('stock', 'PETR4')).toBe(true);
    expect(recorder.requiresExactDailyQuote('fixed_income', 'LFT-20310301')).toBe(false);
    expect(recorder.requiresExactDailyQuote('option_call', 'ITUBF420')).toBe(false);
    expect(recorder.requiresExactDailyQuote('stock', 'PETRF420')).toBe(false);
  });
});
