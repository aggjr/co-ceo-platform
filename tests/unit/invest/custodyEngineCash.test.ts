import { rebuildCustodyFromLedger } from '../../../src/core/invest/CustodyEngine';

/**
 * Caixa pode ficar negativo legitimamente: overdraft de garantia B3 entre
 * exercício de PUT e liberação da garantia (D+3 / D+4) e cheque especial da
 * corretora. Engine não pode descartar esse estado da projeção.
 */
describe('CustodyEngine — caixa', () => {
  const baseEntry = {
    asset_id: 'cash-btg',
    asset_ticker: 'CAIXA-BTG',
    asset_type: 'cash',
    impacts_managerial_price: true,
  };

  it('saldo positivo de abertura aparece como qty positiva (R$)', () => {
    const { assets } = rebuildCustodyFromLedger([
      {
        ...baseEntry,
        transaction_type: 'opening_balance',
        quantity: 1,
        unit_price: 58_758.79,
        total_net_value: 58_758.79,
        transaction_date: '2026-01-01',
      },
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.ticker).toBe('CAIXA-BTG');
    expect(assets[0]!.quantity).toBeCloseTo(58_758.79, 2);
  });

  it('saldo negativo (overdraft de garantia B3) é preservado, não descartado', () => {
    // 01/01: saldo 10.000. Exercício de PUT em sexta-feira consome 50.000
    // em D+1. Garantia liberada em D+4 (segunda da semana seguinte) repõe 60.000.
    const entries = [
      {
        ...baseEntry,
        transaction_type: 'opening_balance',
        quantity: 1,
        unit_price: 10_000,
        total_net_value: 10_000,
        transaction_date: '2026-01-01',
      },
      {
        ...baseEntry,
        transaction_type: 'capital_withdrawal',
        quantity: 1,
        unit_price: 50_000,
        total_net_value: -50_000,
        transaction_date: '2026-01-02',
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.ticker).toBe('CAIXA-BTG');
    expect(assets[0]!.quantity).toBeCloseTo(-40_000, 2);
  });

  it('quando overdraft é reposto via crédito, saldo volta positivo', () => {
    const entries = [
      {
        ...baseEntry,
        transaction_type: 'opening_balance',
        quantity: 1,
        unit_price: 10_000,
        total_net_value: 10_000,
        transaction_date: '2026-01-01',
      },
      {
        ...baseEntry,
        transaction_type: 'capital_withdrawal',
        quantity: 1,
        unit_price: 50_000,
        total_net_value: -50_000,
        transaction_date: '2026-01-02',
      },
      {
        ...baseEntry,
        transaction_type: 'capital_deposit',
        quantity: 1,
        unit_price: 60_000,
        total_net_value: 60_000,
        transaction_date: '2026-01-05',
      },
    ];
    const { assets } = rebuildCustodyFromLedger(entries);
    expect(assets[0]!.quantity).toBeCloseTo(20_000, 2);
  });
});
