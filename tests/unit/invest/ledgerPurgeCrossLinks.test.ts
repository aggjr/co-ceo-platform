import {
  clearLedgerCrossLinksByPreservedIds,
  clearLedgerCrossLinksForOpeningPurge,
} from '../../../src/core/invest/ledgerPurgeCrossLinks';

describe('ledgerPurgeCrossLinks', () => {
  it('clearLedgerCrossLinksByPreservedIds desvincula fle que apontam para ple fora do conjunto preservado', async () => {
    const queries: string[] = [];
    const conn = {
      query: jest.fn(async (sql: string) => {
        queries.push(String(sql));
        return [{ affectedRows: 2 }];
      }),
    };

    await clearLedgerCrossLinksByPreservedIds(conn as never, 'org-1', ['fle-open'], ['ple-open']);

    expect(queries.some((q) => q.includes('ple.related_financial_entry_id = NULL'))).toBe(true);
    expect(queries.some((q) => q.includes('fle.related_patrimony_ledger_id = NULL'))).toBe(true);
    expect(queries.some((q) => q.includes('fle.id NOT IN'))).toBe(true);
    expect(queries.some((q) => q.includes('ple.id NOT IN'))).toBe(true);
  });

  it('clearLedgerCrossLinksForOpeningPurge carrega IDs preservados antes de desvincular', async () => {
    const queries: string[] = [];
    const conn = {
      query: jest.fn(async (sql: string) => {
        queries.push(String(sql));
        if (sql.includes('SELECT id FROM patrimony_ledger_entries')) {
          return [[{ id: 'ple-1' }]];
        }
        if (sql.includes('SELECT id FROM financial_ledger_entries')) {
          return [[{ id: 'fle-1' }]];
        }
        return [{ affectedRows: 1 }];
      }),
    };

    const result = await clearLedgerCrossLinksForOpeningPurge(
      conn as never,
      'org-1',
      '2026-01-01',
      ['ev-open']
    );

    expect(result.pleUnlinked).toBeGreaterThanOrEqual(0);
    expect(queries.filter((q) => q.startsWith('SELECT id')).length).toBe(2);
    expect(queries.some((q) => q.includes('ple.id NOT IN'))).toBe(true);
  });
});
