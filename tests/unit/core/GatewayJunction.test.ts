import { TableRegistry } from '../../../src/core/dal/TableRegistry';

describe('Gateway junction tables', () => {
  it('role_permissions permite hard delete e PK composta', () => {
    const t = TableRegistry.assertRegistered('role_permissions');
    expect(t.allowHardDelete).toBe(true);
    expect(TableRegistry.getPrimaryKeyColumns(t)).toEqual(['role_id', 'permission_id']);
    expect(
      TableRegistry.formatRecordId(t, {
        role_id: 'r1',
        permission_id: 'p1',
      })
    ).toBe('r1:p1');
  });

  it('role_resource_grants permite hard delete', () => {
    const t = TableRegistry.assertRegistered('role_resource_grants');
    expect(t.allowHardDelete).toBe(true);
  });
});
