import { describe, expect, it } from 'vitest';
import {
  buildExtractReconcileFields,
  inferExtractMonth,
  moneyMatch,
  sortParsedExtracts,
} from '../../../src/core/invest/btgExtractBatchReconcile';
import type { BtgExtractImportPreview } from '../../../src/core/invest/btgUploadImportService';

function previewStub(overrides: Partial<BtgExtractImportPreview>): BtgExtractImportPreview {
  return {
    kind: 'extract',
    path: 'x',
    fileName: '2026-02.pdf',
    format: 'pdf',
    lineCount: 10,
    entryCount: 5,
    openingBalance: 1000,
    firstDate: '2026-02-01',
    lastDate: '2026-02-28',
    lastExtractBalance: 1500,
    byOperation: {},
    ...overrides,
  };
}

describe('btgExtractBatchReconcile', () => {
  it('moneyMatch tolera um centavo', () => {
    expect(moneyMatch(1000, 1000.005)).toBe(true);
    expect(moneyMatch(1000, 1000.02)).toBe(false);
  });

  it('inferExtractMonth pelo nome do arquivo', () => {
    expect(inferExtractMonth('extratos/2026-03.pdf', null, null)).toBe('2026-03');
  });

  it('cadeia: saldo inicial bate com final do mês anterior no lote', () => {
    const feb = {
      path: '2026-02.pdf',
      fileName: '2026-02.pdf',
      preview: previewStub({ openingBalance: 1500, lastExtractBalance: 2000 }),
    };
    const fields = buildExtractReconcileFields(feb, [], 1500);
    expect(fields.openingChainOk).toBe(true);
  });

  it('ordena extratos por mês', () => {
    const sorted = sortParsedExtracts([
      {
        path: '2026-03.pdf',
        fileName: '2026-03.pdf',
        preview: previewStub({
          fileName: '2026-03.pdf',
          firstDate: '2026-03-01',
          lastDate: '2026-03-31',
        }),
      },
      {
        path: '2026-01.pdf',
        fileName: '2026-01.pdf',
        preview: previewStub({
          fileName: '2026-01.pdf',
          firstDate: '2026-01-01',
          lastDate: '2026-01-31',
        }),
      },
    ]);
    expect(sorted[0]!.fileName).toBe('2026-01.pdf');
  });
});
