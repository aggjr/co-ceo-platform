import { describe, expect, it } from 'vitest';
import { filterFilesForMonth } from '../../../src/core/invest/btgMonthImportService';

describe('btgMonthImportService', () => {
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
});
