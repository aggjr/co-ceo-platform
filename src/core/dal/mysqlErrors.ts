/** Erro MySQL de tabela/coluna inexistente (migration não aplicada). */
export function isMissingSchemaError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146;
}
