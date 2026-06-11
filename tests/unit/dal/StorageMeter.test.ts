import { StorageMeter, estimatePayloadBytes } from '../../../src/core/dal/StorageMeter';

describe('StorageMeter.resetOrganizationUsage', () => {
  it('zera storage_bytes_used e apaga ledger da organização', async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const query = jest
      .fn()
      .mockResolvedValueOnce([[{ storage_bytes_used: 1_500_000 }]]);

    const conn = { query, execute };

    const result = await StorageMeter.resetOrganizationUsage(
      conn as never,
      'org-holding-001'
    );

    expect(result.previousBytes).toBe(1_500_000);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[0][0])).toContain('organization_storage_ledger');
    expect(String(execute.mock.calls[1][0])).toContain('storage_bytes_used = 0');
  });

  it('recalcula storage_bytes_used a partir das linhas atuais da organização', async () => {
    const row = {
      id: 'acc-1',
      organization_id: 'org-holding-001',
      name: 'Caixa BTG',
      deleted_at: null,
    };
    const expectedBytes = estimatePayloadBytes(row);
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT storage_bytes_used FROM organizations')) {
        return [[{ storage_bytes_used: 1_500_000 }]];
      }
      if (sql.includes('FROM `financial_accounts`')) {
        return [[row]];
      }
      return [[]];
    });
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);

    const result = await StorageMeter.recalculateOrganizationUsage(
      { query, execute } as never,
      'org-holding-001'
    );

    expect(result.previousBytes).toBe(1_500_000);
    expect(result.recalculatedBytes).toBe(expectedBytes);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('DELETE FROM organization_storage_ledger'),
      ['org-holding-001']
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE organizations SET storage_bytes_used = ?'),
      [expectedBytes, 'org-holding-001']
    );
  });
});
