export type GatewayErrorCode =
  | 'TABLE_NOT_ALLOWED'
  | 'COLUMN_NOT_ALLOWED'
  | 'TENANT_ISOLATION_FAILED'
  | 'ORG_NOT_FOUND'
  | 'INVALID_PATH'
  | 'ACCESS_DENIED'
  | 'RECORD_NOT_FOUND'
  | 'STORAGE_LIMIT_EXCEEDED'
  | 'EMPTY_PAYLOAD'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BATCH_TOO_LARGE'
  | 'INVALID_EVENT_TYPE'
  | 'INVALID_EVENT_NAME'
  | 'INVALID_MODULE_CODE'
  | 'METADATA_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'INVALID_CONTEXT';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly httpStatus: number;

  constructor(code: GatewayErrorCode, message: string, httpStatus = 400) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
