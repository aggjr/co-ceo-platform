import { getZonedParts, msUntilNextWallClock } from '../../../src/jobs/cronSchedule';

describe('cronSchedule', () => {
  it('msUntilNextWallClock aponta para o próximo slot em America/Sao_Paulo', () => {
    const tz = 'America/Sao_Paulo';
    const from = Date.UTC(2026, 4, 23, 10, 0, 0);
    const ms = msUntilNextWallClock(3, 15, tz, from);
    const target = new Date(from + ms);
    const p = getZonedParts(target, tz);
    expect(p.hour).toBe(3);
    expect(p.minute).toBe(15);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('quando ja esta no minuto alvo agenda para o proximo dia', () => {
    const tz = 'America/Sao_Paulo';
    const from = Date.UTC(2026, 5, 8, 22, 5, 39); // 19:05:39 em Sao Paulo.
    const ms = msUntilNextWallClock(19, 5, tz, from);
    const target = new Date(from + ms);
    const p = getZonedParts(target, tz);

    expect(p.hour).toBe(19);
    expect(p.minute).toBe(5);
    expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
