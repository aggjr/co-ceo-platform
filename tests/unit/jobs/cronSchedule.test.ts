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
});
