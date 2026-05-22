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

  it('bloqueia organization_id no payload do cliente', () => {
    const t = TableRegistry.assertRegistered('patrimony_items');
    expect(() =>
      TableRegistry.filterWritablePayload(t, { organization_id: 'hack' }, { isInstaller: false })
    ).toThrow(GatewayError);
  });
});
