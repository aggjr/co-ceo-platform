/** Normaliza DATE/DATETIME do MySQL (Date ou string ISO) para YYYY-MM-DD. */
export function isoDateFromRow(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}
