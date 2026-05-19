import { TelemetryService } from '../../../src/core/telemetry/TelemetryService';
import type { CoCeoDataGateway } from '../../../src/core/dal';
import type { UserContext } from '../../../src/core/dal';

const ctx: UserContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  contractId: 'ctr-1',
  impersonatorId: null,
  scope: 'node',
  roleId: 'role-1',
  userRoleId: 'ur-1',
};

describe('TelemetryService', () => {
  const gateway = {
    recordTelemetryEvents: jest.fn().mockResolvedValue(undefined),
  } as unknown as CoCeoDataGateway;

  const service = new TelemetryService(gateway);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('valida e envia lote de screen_view', async () => {
    const result = await service.recordBatch(
      ctx,
      [
        {
          event_type: 'screen_view',
          event_name: 'screen.cockpit.platform',
          module_code: 'CORE',
          screen_path: '/cockpit/platform',
        },
      ],
      { ipAddress: '127.0.0.1', userAgent: 'jest' }
    );

    expect(result.accepted).toBe(1);
    expect(gateway.recordTelemetryEvents).toHaveBeenCalledWith(
      ctx,
      [
        expect.objectContaining({
          event_type: 'screen_view',
          event_name: 'screen.cockpit.platform',
          module_code: 'CORE',
        }),
      ],
      { ipAddress: '127.0.0.1', userAgent: 'jest' }
    );
  });

  it('rejeita event_type inválido', async () => {
    await expect(
      service.recordBatch(ctx, [{ event_type: 'hack', event_name: 'x' }], {})
    ).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('rejeita lote maior que 50', async () => {
    const events = Array.from({ length: 51 }, () => ({
      event_type: 'screen_view' as const,
      event_name: 'screen.test',
    }));
    await expect(service.recordBatch(ctx, events, {})).rejects.toMatchObject({
      httpStatus: 400,
    });
  });
});
