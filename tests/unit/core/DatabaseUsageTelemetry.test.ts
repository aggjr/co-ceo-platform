import { TableRegistry } from '../../../src/core/dal/TableRegistry';
import { GatewayError } from '../../../src/core/dal/errors';

describe('DatabaseUsageTelemetry Registry', () => {
  it('registra database_usage_telemetry como tabela system', () => {
    const t = TableRegistry.assertRegistered('database_usage_telemetry');
    expect(t.kind).toBe('system');
    expect(t.softDelete).toBe(false);
  });

  it('bloqueia colunas de telemetria no payload do cliente', () => {
    const t = TableRegistry.assertRegistered('database_usage_telemetry');
    expect(() =>
      TableRegistry.filterWritablePayload(
        t,
        { operation_type: 'SELECT', bytes_in: 100 },
        { isInstaller: false }
      )
    ).toThrow(GatewayError);
  });
});
