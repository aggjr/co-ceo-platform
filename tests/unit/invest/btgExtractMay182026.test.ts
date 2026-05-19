import {
  BTG_EXTRACT_2026_05_18_19,
  btgExtractMay182026NetCash,
} from '../../../src/core/invest/btgExtractMay182026';

describe('extrato BTG 18–19/05/2026', () => {
  it('valores de movimentação batem com o extrato', () => {
    const byRef = Object.fromEntries(
      BTG_EXTRACT_2026_05_18_19.map((l) => [l.broker_note_ref, l.total_net_value])
    );
    expect(byRef['BTG-EXT-20260518-LFT-SELL-2840358']).toBe(284035.8);
    expect(byRef['BTG-EXT-20260518-LFT-SELL-5680716']).toBe(56807.16);
    expect(byRef['BTG-EXT-20260518-IRRF-LFT-498273']).toBe(-4982.73);
    expect(byRef['BTG-EXT-20260518-CUST-LFT-35811']).toBe(-358.11);
    expect(byRef['BTG-EXT-20260519-LIQ-BOLSA-1505']).toBe(-453223.65);
  });

  it('líquido das linhas do extrato (sem saldo anterior)', () => {
    const net = btgExtractMay182026NetCash();
    expect(net).toBeCloseTo(284035.8 + 56807.16 - 711.34 - 46.93 - 38.44 - 595.59 - 4982.73 - 358.11 - 453223.65, 2);
  });
});
