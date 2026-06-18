import {
  buildCustodyNetZeroEntry,
  canCustodyPairMoves,
  custodyPositionRef,
  splitNetZeroCustodyMoves,
} from '../../../src/core/invest/custodyFeeNetting';

describe('custodyFeeNetting', () => {
  it('extrai POSICAO da descricao BTG', () => {
    expect(
      custodyPositionRef('LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026)')
    ).toBe('1026');
    expect(
      custodyPositionRef('LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA ESTORNO DE TAXA SOBRE POSICAO 1026)')
    ).toBe('1026');
  });

  it('pareia cobranca e estorno com mesma POSICAO e valor oposto', () => {
    const charge = {
      date: '2026-01-19',
      description: 'LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026)',
      movementAmount: 1.72,
      signedNet: -1.72,
      ym: '2026-01',
    };
    const estorno = {
      date: '2026-01-19',
      description: 'LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA ESTORNO DE TAXA SOBRE POSICAO 1026)',
      movementAmount: 1.72,
      signedNet: 1.72,
      ym: '2026-01',
    };
    expect(canCustodyPairMoves(charge, estorno)).toBe(true);

    const { netZero, unmatched } = splitNetZeroCustodyMoves([charge, estorno]);
    expect(unmatched).toHaveLength(0);
    expect(netZero).toHaveLength(1);
    expect(netZero[0]?.total_net_value).toBe(0);
    expect(netZero[0]?.event_source_ref).toMatch(/^BTG-CUSTODIA-NET:2026-01:1026:1026$/);
  });

  it('nao pareia valores diferentes (1.72 vs 1.18)', () => {
    const charge = {
      date: '2026-01-19',
      description: 'LIQ BOLSA (TAXA SOBRE VALOR EM CUSTODIA TAXA SOBRE POSICAO 1026)',
      movementAmount: 1.72,
      signedNet: -1.72,
      ym: '2026-01',
    };
    const reemb = {
      date: '2026-01-21',
      description: 'REEMBOLSO DE CUSTODIA REMUNERADA - ALUGUEL',
      movementAmount: 1.18,
      signedNet: 1.18,
      ym: '2026-01',
    };
    expect(canCustodyPairMoves(charge, reemb)).toBe(false);
    const { netZero, unmatched } = splitNetZeroCustodyMoves([charge, reemb]);
    expect(netZero).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
  });

  it('buildCustodyNetZeroEntry usa data da cobranca quando anterior ao estorno', () => {
    const neg = {
      date: '2026-01-19',
      description: 'taxa',
      movementAmount: 1.72,
      signedNet: -1.72,
      ym: '2026-01',
    };
    const pos = {
      date: '2026-01-19',
      description: 'estorno',
      movementAmount: 1.72,
      signedNet: 1.72,
      ym: '2026-01',
    };
    const entry = buildCustodyNetZeroEntry(neg, pos);
    expect(entry.date).toBe('2026-01-19');
    expect(entry.notes).toContain('liquido zero');
  });
});
