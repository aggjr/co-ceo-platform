import { SettlementEngine } from '../../../../src/core/financial/SettlementEngine';

describe('SettlementEngine.addDays', () => {
  it('INSTANT: same day', () => {
    expect(SettlementEngine.addDays('2026-01-15', 0, true)).toBe('2026-01-15');
  });

  it('B3 D+2 pula final de semana', () => {
    // 2026-01-15 = quinta -> +2 dias uteis = 2026-01-19 (segunda)
    expect(SettlementEngine.addDays('2026-01-15', 2, true)).toBe('2026-01-19');
  });

  it('B3 D+2 quando entra na sexta cai na terça', () => {
    // 2026-01-16 = sexta -> +2 dias uteis = 2026-01-20 (terça)
    expect(SettlementEngine.addDays('2026-01-16', 2, true)).toBe('2026-01-20');
  });

  it('NET_30 sem business_days cai 30 dias corridos', () => {
    expect(SettlementEngine.addDays('2026-01-01', 30, false)).toBe('2026-01-31');
  });

  it('data invalida lanca', () => {
    expect(() => SettlementEngine.addDays('xx', 1, true)).toThrow();
  });
});
