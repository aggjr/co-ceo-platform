import {
  b3OptionTickerFromOpcoesNetSuffix,
  parseOpcoesNetExpirations,
} from '../../../src/core/invest/opcoesNetChainParser';
const expirationFixture = {
  dt: '2026-06-19',
  calls: [['F407', 0, 'E', 40.75, 'I', -0.4042, 28.65]],
  puts: [['R407', 0, 'E', 40.75, 'O', -0.4042, 0.05]],
};

describe('opcoesNetChainParser', () => {
  it('monta ticker B3 a partir do sufixo opcoes.net', () => {
    expect(b3OptionTickerFromOpcoesNetSuffix('PRIO3', 'R407')).toBe('PRIOR407');
    expect(b3OptionTickerFromOpcoesNetSuffix('PRIO3', 'F407')).toBe('PRIOF407');
    expect(b3OptionTickerFromOpcoesNetSuffix('ITUB4', 'R431')).toBe('ITUBR431');
  });

  it('parseia vencimento com strike ajustado (40,75)', () => {
    const rows = parseOpcoesNetExpirations('PRIO3', [expirationFixture], '2026-05-23');
    const put = rows.find((r) => r.ticker === 'PRIOR407');
    const call = rows.find((r) => r.ticker === 'PRIOF407');
    expect(put?.strikePrice).toBe(40.75);
    expect(put?.lastPrice).toBe(0.05);
    expect(put?.quoteDate).toBeNull();
    expect(put?.optionType).toBe('PUT');
    expect(put?.expirationDate).toBe('2026-06-19');
    expect(call?.strikePrice).toBe(40.75);
    expect(call?.optionType).toBe('CALL');
  });

  it('ignora vencimentos já expirados', () => {
    const rows = parseOpcoesNetExpirations('PRIO3', [expirationFixture], '2026-07-01');
    expect(rows).toHaveLength(0);
  });
});
