import {
  assessLiqBolsaFromPendingPools,
  buildMonthReconcileLedger,
  filterFilesForMonth,
  isMonthBtgImportCashEvent,
  resolveLiqBolsaMonthPreview,
  stripBtgImportCashFromMonthForward,
  stripMonthImportCashFromLedger,
} from '../../../src/core/invest/btgMonthImportService';
import type { LedgerEvent } from '../../../src/core/invest/CustodyEngine';

describe('btgMonthImportService', () => {
  it('filterFilesForMonth reconhece fevereiro no caminho', () => {
    const files = [
      { name: 'Notas/fevereiro_2026/nota.pdf', contentBase64: 'x' },
      { name: 'Notas/marco_2026/nota.pdf', contentBase64: 'x' },
    ];
    const fev = filterFilesForMonth(files, '2026-02');
    expect(fev.map((f) => f.name)).toContain('Notas/fevereiro_2026/nota.pdf');
    expect(fev.map((f) => f.name)).not.toContain('Notas/marco_2026/nota.pdf');
  });

  it('filterFilesForMonth reconhece /02/ no caminho', () => {
    const files = [{ name: 'BTG/2026/02/nota.pdf', contentBase64: 'x' }];
    const fev = filterFilesForMonth(files, '2026-02');
    expect(fev).toHaveLength(1);
  });
  it('filterFilesForMonth por pasta 2026-01', () => {
    const files = [
      { name: 'Notas/2026-01/nota1.pdf', contentBase64: 'x' },
      { name: 'Notas/2026-02/nota2.pdf', contentBase64: 'x' },
      { name: 'jan_2026/all.pdf', contentBase64: 'x' },
    ];
    const jan = filterFilesForMonth(files, '2026-01');
    expect(jan.map((f) => f.name)).toContain('Notas/2026-01/nota1.pdf');
    expect(jan.map((f) => f.name)).toContain('jan_2026/all.pdf');
    expect(jan.map((f) => f.name)).not.toContain('Notas/2026-02/nota2.pdf');
  });

  it('stripMonthImportCashFromLedger remove caixa do mês mas preserva abertura', () => {
    const events: LedgerEvent[] = [
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-01',
        total_net_value: 58_758.79,
        broker_note_ref: 'OPENING:2026-01-01:CAIXA-BTG',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-16',
        total_net_value: 219_989.71,
        broker_note_ref: 'BTG-NOTA-27994603#2026-01-16#1:CASH',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-01-09',
        total_net_value: -54_160.08,
        broker_note_ref: 'BTG-EXT-2026-01-09#01',
      } as LedgerEvent,
    ];
    const stripped = stripMonthImportCashFromLedger(events, '2026-01');
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.broker_note_ref).toContain('OPENING:');
    expect(isMonthBtgImportCashEvent(events[1]!, '2026-01')).toBe(true);
    expect(isMonthBtgImportCashEvent(events[0]!, '2026-01')).toBe(false);
  });

  it('stripBtgImportCashFromMonthForward remove caixa do mês alvo e posteriores', () => {
    const events: LedgerEvent[] = [
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-02-28',
        broker_note_ref: 'BTG-EXT-2026-02-28#01',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-03-05',
        broker_note_ref: 'BTG-EXT-2026-03-05#01',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        transaction_date: '2026-04-01',
        broker_note_ref: 'BTG-EXT-2026-04-01#01',
      } as LedgerEvent,
    ];
    const stripped = stripBtgImportCashFromMonthForward(events, '2026-03');
    expect(stripped).toHaveLength(1);
    expect(stripped[0]?.transaction_date).toBe('2026-02-28');
  });

  it('buildMonthReconcileLedger reprojeta extrato quando mes ja tem lancamentos', async () => {
    const events: LedgerEvent[] = [
      {
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'cash_yield',
        transaction_date: '2026-04-01',
        total_net_value: 10,
        broker_note_ref: 'BTG-EXT-2026-04-01#01',
      } as LedgerEvent,
      {
        asset_ticker: 'CAIXA-BTG',
        asset_type: 'cash',
        transaction_type: 'cash_yield',
        transaction_date: '2026-03-31',
        total_net_value: 100,
        broker_note_ref: 'BTG-EXT-2026-03-31#01',
      } as LedgerEvent,
    ];
    const extractFile = {
      name: 'Extrato_202604.txt',
      contentBase64: Buffer.from(
        [
          'Saldo Inicial 100,00',
          '01/04/2026 Rendimento Disponivel - Saldo Remunerado 110,00 10,00',
          '12/04/2026 Rendimento Disponivel - Saldo Remunerado 112,00 2,00',
        ].join('\n'),
        'utf8'
      ).toString('base64'),
    };

    const projected = await buildMonthReconcileLedger(
      '2026-04',
      extractFile,
      events
    );

    expect(projected.some((e) => e.broker_note_ref === 'BTG-EXT-2026-04-01#01')).toBe(false);
    expect(
      projected.filter((e) => String(e.broker_note_ref || '').startsWith('BTG-EXT-2026-04'))
    ).toHaveLength(2);
    expect(projected.reduce((sum, e) => sum + Number(e.total_net_value || 0), 0)).toBeCloseTo(112);
  });

  it('LIQ 06/01 casa bruto da nota PRIOM385 menos taxas separadas (399,48)', () => {
    const result = assessLiqBolsaFromPendingPools(
      '2026-01',
      {
        '2026-01-06': [40_000, -11, -27, -14],
      },
      [{ date: '2026-01-06', signedCents: 39_948 }]
    );
    expect(result.ok).toBe(true);
    expect(result.unresolved).toHaveLength(0);
  });

  it('LIQ sem casamento permanece aberto na previa (nao mascara)', () => {
    const assessment = assessLiqBolsaFromPendingPools(
      '2026-01',
      {},
      [{ date: '2026-01-20', signedCents: 21_998_399 }]
    );
    expect(assessment.ok).toBe(false);
    const preview = resolveLiqBolsaMonthPreview(assessment);
    expect(preview.liqBolsaOk).toBe(false);
    expect(preview.liqBolsaDetail).toContain('sem casamento');
  });

  it('LIQ casada marca previa ok', () => {
    const assessment = assessLiqBolsaFromPendingPools(
      '2026-01',
      { '2026-01-06': [39_948] },
      [{ date: '2026-01-06', signedCents: 39_948 }]
    );
    const preview = resolveLiqBolsaMonthPreview(assessment);
    expect(preview.liqBolsaOk).toBe(true);
  });
});
