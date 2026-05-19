import { CoCeoDataGateway } from '../dal';
import type { UserContext } from '../dal';
import { GatewayError } from '../dal';
import {
  TELEMETRY_EVENT_TYPES,
  type TelemetryEventInput,
  type TelemetryEventType,
  type TelemetryIngestMeta,
} from './types';

const EVENT_NAME_RE = /^[a-z][a-z0-9_.-]{0,99}$/i;
const MODULE_CODE_RE = /^[A-Z][A-Z0-9_]{0,49}$/;
const MAX_BATCH = 50;
const MAX_METADATA_BYTES = 8192;

export class TelemetryService {
  constructor(private readonly gateway: CoCeoDataGateway) {}

  async recordBatch(
    context: UserContext,
    rawEvents: unknown,
    meta: TelemetryIngestMeta
  ): Promise<{ accepted: number }> {
    const events = this.normalizeBatch(rawEvents);
    const validated = events.map((e) => this.validateEvent(e));

    await this.gateway.recordTelemetryEvents(context, validated, meta);
    return { accepted: validated.length };
  }

  private normalizeBatch(raw: unknown): TelemetryEventInput[] {
    if (!raw) {
      throw new GatewayError('EMPTY_PAYLOAD', 'Nenhum evento informado.', 400);
    }
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length > MAX_BATCH) {
      throw new GatewayError(
        'BATCH_TOO_LARGE',
        `Máximo de ${MAX_BATCH} eventos por requisição.`,
        400
      );
    }
    return list as TelemetryEventInput[];
  }

  private validateEvent(raw: TelemetryEventInput): TelemetryEventInput {
    const eventType = String(raw.event_type || '').trim() as TelemetryEventType;
    if (!TELEMETRY_EVENT_TYPES.includes(eventType)) {
      throw new GatewayError(
        'INVALID_EVENT_TYPE',
        `event_type inválido: ${raw.event_type}`,
        400
      );
    }

    const eventName = String(raw.event_name || '').trim();
    if (!EVENT_NAME_RE.test(eventName)) {
      throw new GatewayError('INVALID_EVENT_NAME', 'event_name inválido.', 400);
    }

    let moduleCode: string | null = null;
    if (raw.module_code != null && String(raw.module_code).trim() !== '') {
      moduleCode = String(raw.module_code).trim().toUpperCase();
      if (!MODULE_CODE_RE.test(moduleCode)) {
        throw new GatewayError('INVALID_MODULE_CODE', 'module_code inválido.', 400);
      }
    }

    const screenPath =
      raw.screen_path != null && String(raw.screen_path).trim() !== ''
        ? String(raw.screen_path).slice(0, 255)
        : null;

    const sessionId =
      raw.session_id != null && String(raw.session_id).trim() !== ''
        ? String(raw.session_id).slice(0, 64)
        : null;

    let metadata: Record<string, unknown> | null = null;
    if (raw.metadata != null && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
      const json = JSON.stringify(raw.metadata);
      if (json.length > MAX_METADATA_BYTES) {
        throw new GatewayError('METADATA_TOO_LARGE', 'metadata excede o limite.', 400);
      }
      metadata = raw.metadata as Record<string, unknown>;
    }

    let clientTimestamp: string | null = null;
    if (raw.client_timestamp) {
      const d = new Date(String(raw.client_timestamp));
      if (!Number.isNaN(d.getTime())) {
        clientTimestamp = d.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    return {
      event_type: eventType,
      event_name: eventName,
      module_code: moduleCode,
      screen_path: screenPath,
      session_id: sessionId,
      metadata,
      client_timestamp: clientTimestamp,
    };
  }
}
