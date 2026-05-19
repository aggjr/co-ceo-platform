export const TELEMETRY_EVENT_TYPES = [
  'screen_view',
  'screen_leave',
  'button_click',
  'module_accessed',
  'session_start',
] as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export interface TelemetryEventInput {
  event_type: TelemetryEventType;
  event_name: string;
  module_code?: string | null;
  screen_path?: string | null;
  session_id?: string | null;
  metadata?: Record<string, unknown> | null;
  client_timestamp?: string | null;
}

export interface TelemetryIngestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}
