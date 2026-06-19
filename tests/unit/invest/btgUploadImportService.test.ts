import {
  applyBtgExtractUpload,
  liqBolsaUnknownEventLine,
  previewBtgExtractUpload,
} from '../../../src/core/invest/btgUploadImportService';
import { inferBusinessEventKind } from '../../../src/core/invest/inferBusinessEventKind';

function uploadText(name: string, text: string) {
  return {
    name,
    contentBase64: Buffer.from(text, 'utf8').toString('base64'),
  };
}

describe('btgUploadImportService', () => {
  it('accepts Saldo Anterior as the opening balance label in BTG extracts', async () => {
    const result = await previewBtgExtractUpload(
      uploadText(
        'Jan_2026.txt',
        `
Cont corrente - Movimentacao
01/01/26 Saldo Anterior 58.758,79
31/01/26 Saldo Final + Rendimento Provisionado de Saldo Remunerado - 3.614,36
`
      )
    );

    expect(result.parseOk).toBe(true);
    expect(result.preview?.openingBalance).toBe(58_758.79);
  });

  it('mantem LIQ BOLSA sem casamento como caixa quando fluxo mensal ja validou', async () => {
    const imported: unknown[] = [];
    const ledger = {
      getOpeningLedgerBalance: jest.fn(async () => 100),
      listLedgerEvents: jest.fn(async () => []),
      reconcileCustody: jest.fn(async () => ({ positions: 0 })),
      settleLiqBolsa: jest.fn(async () => ({
        status: 'blocked',
        reason: 'Nenhum evento candidato encontrado para esta data de liquidacao.',
        candidates: [],
        sumCents: 0,
        deltaCents: 350368,
      })),
      importEntriesOnly: jest.fn(async (_ctx, entries) => {
        imported.push(...entries);
        return { batchId: 'b1', inserted: entries.length, skipped: 0, enriched: 0 };
      }),
    };

    const result = await applyBtgExtractUpload(
      { userId: 'u1', organizationId: 'org1', scope: 'test' } as never,
      ledger as never,
      uploadText(
        'Abr_2026.txt',
        [
          'Saldo Inicial 100,00',
          '01/04/2026 LIQ BOLSA (Operacoes)- Pregao:31/03/2026 3.603,68 3.503,68',
        ].join('\n')
      ),
      {
        parseOptions: { includeLiqBolsa: true },
        keepUnmatchedLiqBolsaAsCash: true,
      }
    );

    expect(result.importOk).toBe(true);
    expect(ledger.settleLiqBolsa).toHaveBeenCalled();
    expect(imported).toHaveLength(1);
    expect((imported[0] as { operation?: string }).operation).toBe('pending_settlement');
  });

  it('converte LIQ BOLSA sem casamento em evento desconhecido investigavel', () => {
    const line = liqBolsaUnknownEventLine(
      {
        date: '2026-04-01',
        ticker: 'CAIXA-BTG',
        operation: 'pending_settlement',
        quantity: 0,
        unit_price: 0,
        total_net_value: 3603.68,
        asset_type: 'cash',
        broker_note_ref: 'BTG-EXT-2026-04-01#01',
        notes: 'LIQ BOLSA (Operacoes)- Pregao:31/03/2026',
      },
      'Nenhum evento candidato encontrado para esta data de liquidacao.'
    );

    expect(line.operation).toBe('extract_divergence');
    expect(line.broker_note_ref).toBe('BTG-EXT-2026-04-01#01#LIQ-UNKNOWN');
    expect(line.event_source_ref).toBe('BTG-LIQ-UNKNOWN:2026-04-01:360368');
    expect(line.notes).toContain('PENDENCIA_ANALISE');
    expect(inferBusinessEventKind(line, 'cash_movement')).toBe('unknown_invest_event');
  });
});