import {
  applyBtgExtractUpload,
  previewBtgExtractUpload,
} from '../../../src/core/invest/btgUploadImportService';

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
});
