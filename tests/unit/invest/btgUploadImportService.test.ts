import { previewBtgExtractUpload } from '../../../src/core/invest/btgUploadImportService';

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
});
