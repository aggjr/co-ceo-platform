import { inferFromCashDescription } from '../../../src/core/invest/extractLedgerEnrichment';

describe('inferFromCashDescription — inferencia generica de ticker (sem hardcode de cliente)', () => {
  it('infere o ticker B3 presente na descricao de aluguel (BTC), nao um ticker fixo', () => {
    const r = inferFromCashDescription('Aluguel BTC ITUB4 - Pregão: 15/01/2026', '2026-01-16');
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe('ITUB4');
    expect(r!.originDate).toBe('2026-01-15');
  });

  it('infere ticker em IR - BTC a partir do texto', () => {
    const r = inferFromCashDescription('IR - BTC WEGE3 retido', '2026-02-10');
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe('WEGE3');
  });

  it('retorna null para aluguel/BTC sem ticker reconhecivel (vira pendencia, nao PRIO3)', () => {
    const r = inferFromCashDescription('Aluguel BTC sem identificacao do ativo', '2026-03-01');
    expect(r).toBeNull();
  });

  it('retorna null para IR - BTC sem ticker reconhecivel', () => {
    const r = inferFromCashDescription('IR - BTC sem ticker', '2026-03-01');
    expect(r).toBeNull();
  });

  it('infere LFT (titulo publico) pela descricao', () => {
    const r = inferFromCashDescription('TESOURO DIRETO LFT 01/03/2027', '2026-01-20');
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe('LFT-20270301');
  });
});
