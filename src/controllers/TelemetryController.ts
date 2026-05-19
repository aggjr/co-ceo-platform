import { Request, Response } from 'express';
import { CoCeoDataGateway } from '../core/dal';
import { TelemetryService } from '../core/telemetry/TelemetryService';

export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  ingest = async (req: Request, res: Response) => {
    try {
      const ctx = req.userContext!;
      const body = req.body as { events?: unknown };
      const raw = body?.events ?? body;
      const ipAddress =
        (typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
          : null) || req.socket.remoteAddress || null;
      const userAgent =
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

      const result = await this.telemetry.recordBatch(ctx, raw, { ipAddress, userAgent });
      return res.status(202).json({ success: true, ...result });
    } catch (error: unknown) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 500;
      const message = error instanceof Error ? error.message : 'Erro ao registrar telemetria';
      return res.status(status).json({ success: false, error: message });
    }
  };
}

export function createTelemetryController(gateway: CoCeoDataGateway): TelemetryController {
  return new TelemetryController(new TelemetryService(gateway));
}
