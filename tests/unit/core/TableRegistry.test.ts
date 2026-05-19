import { TableRegistry } from '../../../src/core/dal/TableRegistry';
import { GatewayError } from '../../../src/core/dal/errors';

describe('TableRegistry', () => {
  it('bloqueia tabela não registrada', () => {
    expect(() => TableRegistry.assertRegistered('tabela_inexistente')).toThrow(GatewayError);
  });

  it('registra invest_assets', () => {
    const t = TableRegistry.assertRegistered('invest_assets');
    expect(t.kind).toBe('tenant');
    expect(t.softDelete).toBe(true);
  });

  it('bloqueia organization_id no payload do cliente', () => {
    const t = TableRegistry.assertRegistered('invest_assets');
    expect(() =>
      TableRegistry.filterWritablePayload(t, { organization_id: 'hack' }, { isInstaller: false })
    ).toThrow(GatewayError);
  });
});
