export type ReconcileActivityLevel = 'info' | 'ok' | 'warn' | 'error';

export type ReconcileActivityStep = {
  at: string;
  level: ReconcileActivityLevel;
  command?: string;
  message: string;
};

export function reconcileActivity(
  organizationId: string | undefined,
  message: string,
  opts?: { command?: string; level?: ReconcileActivityLevel }
): ReconcileActivityStep {
  const level = opts?.level ?? 'info';
  const step: ReconcileActivityStep = {
    at: new Date().toISOString(),
    level,
    command: opts?.command,
    message,
  };
  const org = organizationId ?? '—';
  const cmd = opts?.command ? ` [${opts.command}]` : '';
  const line = `[invest:reconcile] org=${org}${cmd} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  return step;
}
