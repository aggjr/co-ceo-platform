import { StorageMeter } from '../../../src/core/dal/StorageMeter';

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
});
