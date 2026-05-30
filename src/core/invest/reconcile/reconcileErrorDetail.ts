import { GatewayError } from '../../dal/errors';

export type ReconcileErrorDetail = {
  message: string;
  code?: string;
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

type MysqlLikeError = {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
};

export function formatReconcileError(
  error: unknown,
  context?: Record<string, unknown>
): ReconcileErrorDetail {
  const err = error instanceof Error ? error : new Error(String(error));
  const mysql = error as MysqlLikeError;
  const detail: ReconcileErrorDetail = {
    message: err.message,
    stack: err.stack,
    context,
  };

  if (error instanceof GatewayError) {
    detail.code = error.code;
    return detail;
  }

  if (mysql.code) {
    detail.code = mysql.code;
    detail.errno = mysql.errno;
    detail.sqlMessage = mysql.sqlMessage;
    detail.sqlState = mysql.sqlState;
  }

  return detail;
}

/** Log estruturado no servidor + objeto para retorno à UI. */
export function logReconcileFailure(
  scope: string,
  orgId: string | undefined,
  error: unknown,
  context?: Record<string, unknown>
): ReconcileErrorDetail {
  const detail = formatReconcileError(error, context);
  const parts = [
    `scope=${scope}`,
    detail.message,
    detail.code ? `code=${detail.code}` : '',
    detail.errno != null ? `errno=${detail.errno}` : '',
    detail.sqlMessage ? `sqlMessage=${detail.sqlMessage}` : '',
    context && Object.keys(context).length ? `ctx=${JSON.stringify(context)}` : '',
  ].filter(Boolean);

  console.error(`[invest:reconcile] org=${orgId ?? '—'} FALHA ${parts.join(' | ')}`);
  if (detail.stack) {
    console.error(detail.stack);
  }

  return detail;
}
