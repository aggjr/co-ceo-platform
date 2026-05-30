import { TableRegistry } from '../../../src/core/dal/TableRegistry';
import { GatewayError } from '../../../src/core/dal/errors';

describe('TableRegistry', () => {
  it('bloqueia tabela não registrada', () => {
    expect(() => TableRegistry.assertRegistered('tabela_inexistente')).toThrow(GatewayError);
  });

  it('registra patrimony_items (nucleo canonico)', () => {
    const t = TableRegistry.assertRegistered('patrimony_items');
    expect(t.kind).toBe('tenant');
    expect(t.softDelete).toBe(true);
  });

  it('remove organization_id do payload do cliente (injetado pelo gateway)', () => {
    const t = TableRegistry.assertRegistered('patrimony_items');
    const filtered = TableRegistry.filterWritablePayload(
      t,
      { organization_id: 'hack', identifier: 'PETR4' },
      { isInstaller: false }
    );
    expect(filtered).toEqual({ identifier: 'PETR4' });
    expect(filtered.organization_id).toBeUndefined();
  });
});
