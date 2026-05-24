/** Próximo disparo para horário de parede em um fuso (ex.: 03:15 America/Sao_Paulo). */
export function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function msUntilNextWallClock(
  hour: number,
  minute: number,
  timeZone: string,
  fromMs = Date.now()
): number {
  let probe = fromMs;
  for (let i = 0; i < 60 * 24 * 4; i++) {
    const p = getZonedParts(new Date(probe), timeZone);
    if (p.hour === hour && p.minute === minute) {
      return Math.max(0, probe - fromMs);
    }
    probe += 60_000;
  }
  return 24 * 60 * 60 * 1000;
}

export function scheduleDailyWallClock(
  hour: number,
  minute: number,
  timeZone: string,
  label: string,
  fn: () => Promise<void>
): void {
  const plan = () => {
    const delay = msUntilNextWallClock(hour, minute, timeZone);
    const next = new Date(Date.now() + delay);
    console.log(
      `[cron] ${label} — próxima execução ${next.toISOString()} (${timeZone} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}, em ${Math.round(delay / 60_000)} min)`
    );
    setTimeout(async () => {
      try {
        console.log(`[cron] ${label} — iniciando ${new Date().toISOString()}`);
        await fn();
        console.log(`[cron] ${label} — concluído ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`[cron] ${label} — falhou:`, err);
      }
      plan();
    }, delay);
  };
  plan();
}
